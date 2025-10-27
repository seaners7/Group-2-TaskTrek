// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

// ✅ Initialize Admin SDK *once*
if (!admin.apps.length) {
    admin.initializeApp();
}
setGlobalOptions({ maxInstances: 10 });

// ✅ Define db globally *once*
const db = admin.firestore();

/**
 * Helper function to get group points chart data
 * This is used by getDashboardData
 * ✅ Removed 'db' argument, will use global 'db'
 */
async function getGroupPointsChart(activeGroupId, userId) {
    try {
        const groupDoc = await db.collection("groups").doc(activeGroupId).get();
        const memberIds = groupDoc.data()?.members;
        if (!memberIds || memberIds.length === 0) return { pointsChartData: { labels: ['No Members'], datasets: [{ data: [1] }] } };

        const membersQuery = db.collection("users").where(admin.firestore.FieldPath.documentId(), "in", memberIds.slice(0, 30)).orderBy("points", "desc");
        const membersSnapshot = await membersQuery.get();
        const chartLabels = [], chartData = [];
        let otherPoints = 0, maxSlices = 4;
        let currentUserData = null; const otherMembers = [];
        membersSnapshot.forEach(doc => { (doc.id === userId) ? currentUserData = doc.data() : otherMembers.push(doc.data()); });
        
        chartLabels.push(currentUserData?.name || 'You');
        chartData.push(currentUserData?.points || 0);
        otherMembers.forEach((user, index) => { (index < maxSlices) ? (chartLabels.push(user.name || 'Unnamed'), chartData.push(user.points || 0)) : otherPoints += (user.points || 0); });
        if (otherPoints > 0) { chartLabels.push('Other Members'); chartData.push(otherPoints); }
        
        return { pointsChartData: { labels: chartLabels, datasets: [{ data: chartData, backgroundColor: ['#8b5cf6', '#a78bfa', '#c084fc', '#f59e0b', '#10b981', '#6b7280'], borderColor: 'var(--bg)', borderWidth: 2 }] } };
    } catch (e) {
        logger.error(`Error fetching group member points:`, e);
        throw new HttpsError("internal", "Failed to get group points. Check logs for index link.", e.message);
    }
}


/**
 * Calculates all dynamic data for the main dashboard.
 */
exports.getDashboardData = onCall(async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be logged in.");
    
    const userId = request.auth.uid;
    // ✅ REMOVED: const db = admin.firestore();
    const { period = 'month' } = request.data;
    logger.info(`Fetching dashboard data for user: ${userId}, period: ${period}`);

    // --- 0. Get User and Active Group ---
    let activeGroupId = null;
    let userDoc, userData;
    try {
        userDoc = await db.collection("users").doc(userId).get(); // Uses global db
        if (!userDoc.exists) throw new HttpsError("not-found", "User document not found.");
        userData = userDoc.data();
        activeGroupId = userData.activeGroupId;
    } catch (e) {
        logger.error("Error getting user doc:", e);
        throw new HttpsError("internal", "Could not fetch user data.");
    }
    
    // --- 1. Define Time Boundaries ---
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const lastWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const startOfTodayTimestamp = admin.firestore.Timestamp.fromDate(todayStart);
    const startOfWeekTimestamp = admin.firestore.Timestamp.fromDate(weekStart);
    const startOfLastWeekTimestamp = admin.firestore.Timestamp.fromDate(lastWeekStart);
    const todayStr = todayStart.toISOString().split('T')[0];

    // --- 2. Initialize Counters ---
    let userRank = null;
    let tasksTotal = 0, tasksInProgress = 0, tasksCompleted = 0, tasksDueToday = 0;
    let pointsThisWeek = 0, tasksCompletedThisWeek = 0;
    let totalTasksTrend = "+0%";
    
    // --- 3. Handle No Active Group ---
    if (!activeGroupId) {
        logger.warn(`User ${userId} has no active group. Returning partial data.`);
        try {
             const usersQuery = db.collection("users").orderBy("points", "desc"); // Uses global db
             const usersSnapshot = await usersQuery.get();
             const rankIndex = usersSnapshot.docs.findIndex(doc => doc.id === userId);
             if (rankIndex !== -1) userRank = rankIndex + 1;
        } catch (e) { logger.error("Error getting rank:", e); }
        return { 
            userPoints: userData.points || 0, userRank: userRank, tasksTotal: 0, tasksInProgress: 0, 
            tasksCompleted: 0, tasksDueToday: 0, completionRate: 0, pointsThisWeek: 0, tasksCompletedThisWeek: 0,
            taskChartData: { labels: ['No Group Selected'], datasets: [] }, 
            pointsChartData: { labels: ['No Group Selected'], datasets: [{ data: [1] }] }, 
            totalTasksTrend: "N/A" 
        };
    }
    
    // --- 4. Process All Data (User has Active Group) ---
    try {
        // Get User Rank (Global)
        const usersQuery = db.collection("users").orderBy("points", "desc"); // Uses global db
        const usersSnapshot = await usersQuery.get();
        const rankIndex = usersSnapshot.docs.findIndex(doc => doc.id === userId);
        if (rankIndex !== -1) userRank = rankIndex + 1;

        // Process User-Specific Tasks (Stats Cards)
        const userTasksQuery = db.collection("tasks").where("assignee", "==", userId).where("groupId", "==", activeGroupId); // Uses global db
        const userTasksSnapshot = await userTasksQuery.get();
        userTasksSnapshot.forEach(doc => {
            const task = doc.data(); tasksTotal++;
            if (task.status === "in-progress") tasksInProgress++;
            if (task.dueDate === todayStr && task.status !== 'completed') tasksDueToday++;
            if (task.status === "completed") {
                tasksCompleted++;
                const completedAt = task.completedAt;
                if (completedAt && completedAt instanceof admin.firestore.Timestamp && completedAt.toDate() >= startOfWeekTimestamp) {
                    tasksCompletedThisWeek++; pointsThisWeek += (task.points || 0);
                }
            }
        });
        const completionRate = tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0;

        // Process Group Tasks (for Line Chart & Trend)
        let chartStartDate, numUnits, labels = [];
        if (period === 'week') {
            chartStartDate = new Date(now.getTime()); chartStartDate.setDate(chartStartDate.getDate() - 6); chartStartDate.setHours(0, 0, 0, 0); numUnits = 7;
            for (let i = 0; i < numUnits; i++) { const day = new Date(chartStartDate.getTime()); day.setDate(day.getDate() + i); labels.push(day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })); }
        } else {
            chartStartDate = new Date(now.getTime()); chartStartDate.setDate(chartStartDate.getDate() - 27); chartStartDate.setHours(0, 0, 0, 0); numUnits = 4;
            labels.push('3 Weeks Ago', '2 Weeks Ago', 'Last Week', 'This Week');
        }
        
        const chartStartDateTimestamp = admin.firestore.Timestamp.fromDate(chartStartDate);
        const groupTasksQuery = db.collection("tasks").where("groupId", "==", activeGroupId).where("createdAt", ">=", startOfLastWeekTimestamp); // Uses global db
        const groupTasksSnapshot = await groupTasksQuery.get();
        
        let tasksCompletedByUnit = Array(numUnits).fill(0), tasksCreatedByUnit = Array(numUnits).fill(0);
        let tasksCreatedThisWeekCount = 0, tasksCreatedLastWeekCount = 0;
        groupTasksSnapshot.forEach(doc => {
            const task = doc.data();
            if (task.createdAt && task.createdAt instanceof admin.firestore.Timestamp) {
                const createdAt = task.createdAt.toDate();
                if (createdAt >= startOfWeekTimestamp) tasksCreatedThisWeekCount++;
                else if (createdAt >= startOfLastWeekTimestamp) tasksCreatedLastWeekCount++;
                if (createdAt >= chartStartDate) {
                    let index;
                    if (period === 'week') index = Math.floor((createdAt.getTime() - chartStartDate.getTime()) / (1000 * 60 * 60 * 24));
                    else index = Math.floor((createdAt.getTime() - chartStartDate.getTime()) / (1000 * 60 * 60 * 24 * 7));
                    if (index >= 0 && index < numUnits) tasksCreatedByUnit[index]++;
                    const completedAt = task.completedAt;
                    if (task.status === 'completed' && completedAt && completedAt instanceof admin.firestore.Timestamp && completedAt.toDate() >= chartStartDate) {
                        if (period === 'week') index = Math.floor((completedAt.toDate().getTime() - chartStartDate.getTime()) / (1000 * 60 * 60 * 24));
                        else index = Math.floor((completedAt.toDate().getTime() - chartStartDate.getTime()) / (1000 * 60 * 60 * 24 * 7));
                        if (index >= 0 && index < numUnits) tasksCompletedByUnit[index]++;
                    }
                }
            }
        });
        if (tasksCreatedLastWeekCount > 0) {
            const percentChange = Math.round(((tasksCreatedThisWeekCount - tasksCreatedLastWeekCount) / tasksCreatedLastWeekCount) * 100);
            totalTasksTrend = percentChange >= 0 ? `+${percentChange}% this week` : `${percentChange}% this week`;
        } else if (tasksCreatedThisWeekCount > 0) {
            totalTasksTrend = "+100% this week";
        } else {
            totalTasksTrend = "0% this week";
        }
        
        const taskChartData = {
            labels: labels,
            datasets: [
                { label: 'Tasks Completed', data: tasksCompletedByUnit, borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.1)', borderWidth: 2, fill: true, tension: 0.4 },
                { label: 'Tasks Created', data: tasksCreatedByUnit, borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', borderWidth: 2, fill: false, tension: 0.4 }
            ]
        };

        // Process Group Member Points (Donut Chart)
        const { pointsChartData } = await getGroupPointsChart(activeGroupId, userId); // ✅ REMOVED db

        // --- 7. Return Full Payload ---
        return {
            userPoints: userData.points || 0, userRank: userRank,
            tasksTotal: tasksTotal, tasksInProgress: tasksInProgress, tasksCompleted: tasksCompleted,
            tasksDueToday: tasksDueToday, completionRate: completionRate,
            pointsThisWeek: pointsThisWeek, tasksCompletedThisWeek: tasksCompletedThisWeek,
            taskChartData: taskChartData,
            pointsChartData: pointsChartData,
            totalTasksTrend: totalTasksTrend
        };

    } catch (error) {
        logger.error(`Error fetching full dashboard stats for ${userId}:`, error);
        throw new HttpsError("internal", "Failed to fetch dashboard data.", error.message);
    }
});

// --- Function 2: inviteMemberToGroup ---
exports.inviteMemberToGroup = onCall(async (request) => {
    if (!request.auth) { logger.error("Invite Member: Auth check failed."); throw new HttpsError("unauthenticated", "User must be logged in."); }
    const inviterId = request.auth.uid; const { email, groupId } = request.data;
    if (!email || !groupId) { throw new HttpsError("invalid-argument", "Email and groupId required."); }
    // ✅ REMOVED: const db = admin.firestore();
    try {
        const groupRef = db.collection("groups").doc(groupId); // Uses global db
        const groupDoc = await groupRef.get();
        if (!groupDoc.exists) { throw new HttpsError("not-found", "Group not found."); }
        const groupData = groupDoc.data();
        if (!groupData.admins || !groupData.admins.includes(inviterId)) {
            throw new HttpsError("permission-denied", "Only group admins can invite members.");
        }
        let userToInviteRecord; try { userToInviteRecord = await admin.auth().getUserByEmail(email); } catch (error) { if (error.code === 'auth/user-not-found') { throw new HttpsError("not-found", `User ${email} not found.`); } throw new HttpsError("internal", "Error looking up user."); }
        const userToInviteId = userToInviteRecord.uid;
        if (groupData.members?.includes(userToInviteId)) { return { success: true, message: `User ${email} is already a member.` }; }
        await groupRef.update({ members: admin.firestore.FieldValue.arrayUnion(userToInviteId) });
        logger.info(`User ${userToInviteId} added to group ${groupId} by ${inviterId}`);
        await db.collection("activities").add({ groupId: groupId, userName: groupData.name, type: 'member-invited', details: `Invited ${email} to the group.`, createdAt: admin.firestore.FieldValue.serverTimestamp() }); // Uses global db
        return { success: true, message: `User ${email} successfully added!` };
    } catch (error) { if (error instanceof HttpsError) { logger.error(`Invite Error: ${error.message}`); throw error; } else { logger.error(`Unexpected Invite Error:`, error); throw new HttpsError("internal", "Unexpected error."); } }
});

// --- Function 3: getGroupStats ---
exports.getGroupStats = onCall(async (request) => {
    if (!request.auth) { logger.error("Get Group Stats: Auth check failed."); throw new HttpsError("unauthenticated", "User must be logged in."); }
    const userId = request.auth.uid; const { groupId } = request.data;
    if (!groupId) { throw new HttpsError("invalid-argument", "GroupId is required."); }
    // ✅ REMOVED: const db = admin.firestore();
    logger.info(`Fetching stats for group ${groupId}, called by user ${userId}`);
    try {
        const groupRef = db.collection("groups").doc(groupId); // Uses global db
        const groupDoc = await groupRef.get();
        if (!groupDoc.exists) { throw new HttpsError("not-found", "Group not found."); }
        const groupData = groupDoc.data(); let memberIds = groupData.members;
        if (!memberIds || memberIds.length === 0) { logger.info(`Group ${groupId} has no members.`); return { activeToday: 0, newThisWeek: 0 }; }
        
        const now = new Date(); 
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const startOfTodayTimestamp = admin.firestore.Timestamp.fromDate(todayStart); 
        const startOfWeekTimestamp = admin.firestore.Timestamp.fromDate(weekStart);
        
        const memberIdsToQuery = memberIds.length > 30 ? memberIds.slice(0, 30) : memberIds;
        if (memberIds.length > 30) logger.warn(`Group ${groupId} has ${memberIds.length} members, querying stats only for first 30.`);
        
        const membersQuery = db.collection("users").where(admin.firestore.FieldPath.documentId(), "in", memberIdsToQuery); // Uses global db
        const membersSnapshot = await membersQuery.get();
        
        let activeTodayCount = 0; let newThisWeekCount = 0;
        membersSnapshot.forEach(doc => {
             const userData = doc.data();
             
             const lastLogin = userData.lastLogin;
             if (lastLogin) {
                 const lastLoginDate = (lastLogin instanceof admin.firestore.Timestamp) ? lastLogin.toDate() : new Date(lastLogin);
                 if (lastLoginDate >= todayStart) {
                     activeTodayCount++;
                 }
             }
             
             const createdAt = userData.createdAt;
             if (createdAt) {
                 const createdAtDate = (createdAt instanceof admin.firestore.Timestamp) ? createdAt.toDate() : new Date(createdAt);
                 if (createdAtDate >= weekStart) {
                     newThisWeekCount++;
                 }
             }
        });
        
        logger.info(`Stats for group ${groupId}: ActiveToday=${activeTodayCount}, NewThisWeek=${newThisWeekCount}`);
        return { activeToday: activeTodayCount, newThisWeek: newThisWeekCount };
    } catch (error) { if (error instanceof HttpsError) { logger.error(`Error getting group stats for ${groupId}: ${error.message}`); throw error; } else { logger.error(`Unexpected error getting group stats for ${groupId}:`, error); throw new HttpsError("internal", "An unexpected error occurred."); } }
});

// --- Function 4: deleteGroup ---
exports.deleteGroup = onCall(async (request) => {
    if (!request.auth) {
        logger.error("Delete Group: Auth check failed.");
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }
    
    const userId = request.auth.uid;
    const { groupId } = request.data;
    
    if (!groupId) {
        throw new HttpsError("invalid-argument", "groupId is required.");
    }
    
    // ✅ REMOVED: const db = admin.firestore();
    const groupRef = db.collection("groups").doc(groupId); // Uses global db
    
    logger.info(`User ${userId} attempting to delete group ${groupId}`);

    try {
        // --- 1. Verify Ownership ---
        const groupDoc = await groupRef.get();
        if (!groupDoc.exists) {
            throw new HttpsError("not-found", "Group not found.");
        }
        
        const groupData = groupDoc.data();
        if (groupData.ownerId !== userId) {
            logger.warn(`Permission denied: User ${userId} is not owner of group ${groupId}.`);
            throw new HttpsError("permission-denied", "Only the group owner can delete this group.");
        }

        // --- 2. Prepare to delete all associated data ---
        let batch = db.batch(); // Uses global db
        let operationCount = 0;
        
        // Helper function to query and add deletes to batch
        const deleteCollection = async (collectionName) => {
            const snapshot = await db.collection(collectionName).where("groupId", "==", groupId).get(); // Uses global db
            if (!snapshot.empty) {
                 logger.info(`Found ${snapshot.size} documents in ${collectionName} to delete.`);
                 
                 // ✅ FIX: Use for...of loop which respects await
                 for (const doc of snapshot.docs) {
                     batch.delete(doc.ref);
                     operationCount++;
                     
                     if (operationCount >= 499) {
                         logger.warn("Batch limit (500) reached, committing and starting new batch.");
                         await batch.commit();
                         batch = db.batch(); // Uses global db
                         operationCount = 0;
                     }
                 }
            }
        };

        // --- 3. Delete associated data ---
        await deleteCollection('tasks');
        await deleteCollection('shopItems');
        await deleteCollection('activities');

        // --- 4. Find users who have this group as active ---
        const usersToUpdateSnapshot = await db.collection('users').where("activeGroupId", "==", groupId).get(); // Uses global db
        if (!usersToUpdateSnapshot.empty) {
            logger.info(`Found ${usersToUpdateSnapshot.size} users to update activeGroupId for.`);
            
            // ✅ FIX: Use for...of loop which respects await
            for (const userDoc of usersToUpdateSnapshot.docs) {
                batch.update(userDoc.ref, { activeGroupId: null });
                operationCount++;
                 if (operationCount >= 499) {
                     logger.warn("Batch limit (500) reached during user update, committing and starting new batch.");
                     await batch.commit();
                     batch = db.batch();
                     operationCount = 0;
                 }
            }
        }

        // --- 5. Delete the group itself ---
        batch.delete(groupRef);
        operationCount++;
        
        // --- 6. Commit the final batch ---
        logger.info(`Committing final batch with ${operationCount} operations.`);
        await batch.commit();
        
        logger.info(`Successfully deleted group ${groupId} and all associated data.`);
        return { success: true };

    } catch (error) {
        logger.error(`Error deleting group ${groupId}:`, error);
        if (error instanceof HttpsError) {
            throw error; // Re-throw HttpsError
        } else {
            throw new HttpsError("internal", "An unexpected error occurred while deleting the group.");
        }
    }
});

// --- Function 5: toggleAdminStatus ---
exports.toggleAdminStatus = onCall(async (request) => {
    if (!request.auth) { throw new HttpsError("unauthenticated", "User must be logged in."); }
    const adminId = request.auth.uid; const { groupId, targetUserId, makeAdmin } = request.data;
    if (!groupId || !targetUserId) { throw new HttpsError("invalid-argument", "groupId and targetUserId are required."); }
    // ✅ REMOVED: const db = admin.firestore();
    const groupRef = db.collection("groups").doc(groupId); // Uses global db
    try {
        const groupDoc = await groupRef.get();
        if (!groupDoc.exists) { throw new HttpsError("not-found", "Group not found."); }
        const groupData = groupDoc.data();
        if (!groupData.admins || !groupData.admins.includes(adminId)) {
            throw new HttpsError("permission-denied", "Only group admins can change roles.");
        }
        if (targetUserId === groupData.ownerId) {
             throw new HttpsError("permission-denied", "The group owner's admin status cannot be revoked.");
        }
        let message = "";
        if (makeAdmin) {
            await groupRef.update({ admins: admin.firestore.FieldValue.arrayUnion(targetUserId) });
            message = "User promoted to admin.";
        } else {
            await groupRef.update({ admins: admin.firestore.FieldValue.arrayRemove(targetUserId) });
            message = "User demoted to member.";
        }
        return { success: true, message: message };
    } catch (error) {
        if (error instanceof HttpsError) throw error;
        logger.error(`Error toggling admin status:`, error);
        throw new HttpsError("internal", "An unexpected error occurred.");
    }
});