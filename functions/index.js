// functions/index.js
const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

// --- Function 1: getDashboardStats ---
exports.getDashboardStats = onCall(async (request) => {
    if (!request.auth) {
        logger.error("Authentication check failed.");
        throw new HttpsError("unauthenticated", "User must be logged in.");
    }
    const userId = request.auth.uid;
    const db = admin.firestore();
    logger.info(`Fetching dashboard stats for user: ${userId}`);

    // Timestamps for calculations
    const now = new Date(); // Define 'now' here
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()); // Recalculate start of week based on 'now'
    weekStart.setHours(0, 0, 0, 0);

    const startOfTodayTimestamp = admin.firestore.Timestamp.fromDate(todayStart);
    const startOfWeekTimestamp = admin.firestore.Timestamp.fromDate(weekStart);
    const todayStr = todayStart.toISOString().split('T')[0]; // YYYY-MM-DD format for due date comparison

    let pointsToday = 0;
    let userRank = null;
    let tasksDueToday = 0;
    let tasksCompletedThisWeek = 0;

    try {
        // --- Calculate Points Today ---
        const activitiesQuery = db.collection("activities")
            .where("userId", "==", userId)
            .where("createdAt", ">=", startOfTodayTimestamp);
        const activitySnapshot = await activitiesQuery.get();
        activitySnapshot.forEach(doc => {
            const activity = doc.data();
            const pointsMatch = activity.details?.match(/\+(\d+)\s*pts/);
            if (pointsMatch?.[1]) pointsToday += parseInt(pointsMatch[1], 10);
        });

        // --- Calculate Rank ---
        const usersQuery = db.collection("users").orderBy("points", "desc");
        const usersSnapshot = await usersQuery.get();
        const rankIndex = usersSnapshot.docs.findIndex(doc => doc.id === userId);
        if (rankIndex !== -1) userRank = rankIndex + 1;

        // --- Calculate Tasks Due Today & Completed This Week ---
        const tasksQuery = db.collection("tasks").where("assignee", "==", userId);
        const tasksSnapshot = await tasksQuery.get();
        tasksSnapshot.forEach(doc => {
            const task = doc.data();
            if (task.dueDate === todayStr && task.status !== 'completed') {
                tasksDueToday++;
            }
            // Ensure completedAt is a Timestamp before comparing
            if (task.completedAt && task.completedAt instanceof admin.firestore.Timestamp && task.completedAt.toDate() >= startOfWeekTimestamp.toDate()) {
                 tasksCompletedThisWeek++;
            } else if (task.completedAt && !(task.completedAt instanceof admin.firestore.Timestamp)) {
                // Log if completedAt is not a Timestamp (it should be if saved with serverTimestamp)
                logger.warn(`Task ${doc.id} has invalid completedAt type:`, task.completedAt);
            }
        });

        logger.info(`Calculated dashboard stats: pointsToday=${pointsToday}, userRank=${userRank}, tasksDueToday=${tasksDueToday}, tasksCompletedThisWeek=${tasksCompletedThisWeek}`);

        // --- Return all calculated data ---
        return {
            pointsEarnedToday: pointsToday,
            userRank: userRank,
            tasksDueToday: tasksDueToday,
            tasksCompletedThisWeek: tasksCompletedThisWeek
        };

    } catch (error) {
        logger.error(`Error fetching dashboard stats for ${userId}:`, error);
        throw new HttpsError("internal", "Failed to fetch dashboard stats.");
    }
}); // <= END OF getDashboardStats


// --- Function 2: inviteMemberToGroup ---
exports.inviteMemberToGroup = onCall(async (request) => {
    if (!request.auth) { logger.error("Invite Member: Auth check failed."); throw new HttpsError("unauthenticated", "User must be logged in."); }
    const inviterId = request.auth.uid; const { email, groupId } = request.data;
    if (!email || !groupId) { throw new HttpsError("invalid-argument", "Email and groupId required."); }
    const db = admin.firestore();
    try {
        const groupRef = db.collection("groups").doc(groupId); const groupDoc = await groupRef.get();
        if (!groupDoc.exists) { throw new HttpsError("not-found", "Group not found."); }
        const groupData = groupDoc.data(); if (groupData.ownerId !== inviterId) { throw new HttpsError("permission-denied", "Only owner can invite."); }
        let userToInviteRecord; try { userToInviteRecord = await admin.auth().getUserByEmail(email); } catch (error) { if (error.code === 'auth/user-not-found') { throw new HttpsError("not-found", `User ${email} not found.`); } throw new HttpsError("internal", "Error looking up user."); }
        const userToInviteId = userToInviteRecord.uid;
        if (groupData.members?.includes(userToInviteId)) { return { success: true, message: `User ${email} is already a member.` }; }
        await groupRef.update({ members: admin.firestore.FieldValue.arrayUnion(userToInviteId) });
        logger.info(`User ${userToInviteId} added to group ${groupId} by ${inviterId}`);
        await db.collection("activities").add({ groupId: groupId, userName: groupData.name, type: 'member-invited', details: `Invited ${email} to the group.`, createdAt: admin.firestore.FieldValue.serverTimestamp() });
        return { success: true, message: `User ${email} successfully added!` };
    } catch (error) { if (error instanceof HttpsError) { logger.error(`Invite Error: ${error.message}`); throw error; } else { logger.error(`Unexpected Invite Error:`, error); throw new HttpsError("internal", "Unexpected error."); } }
}); // <= END OF inviteMemberToGroup


// --- Function 3: getGroupStats ---
exports.getGroupStats = onCall(async (request) => {
    if (!request.auth) { logger.error("Get Group Stats: Auth check failed."); throw new HttpsError("unauthenticated", "User must be logged in."); }
    const userId = request.auth.uid; const { groupId } = request.data;
    if (!groupId) { throw new HttpsError("invalid-argument", "GroupId is required."); }
    const db = admin.firestore(); logger.info(`Fetching stats for group ${groupId}, called by user ${userId}`);
    try {
        const groupRef = db.collection("groups").doc(groupId); const groupDoc = await groupRef.get();
        if (!groupDoc.exists) { throw new HttpsError("not-found", "Group not found."); }
        const groupData = groupDoc.data(); let memberIds = groupData.members;
        // Optional: Check if caller is member - removed for now, assumed ok
        if (!memberIds || memberIds.length === 0) { logger.info(`Group ${groupId} has no members.`); return { activeToday: 0, newThisWeek: 0 }; }
        const now = new Date(); const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()); // Recalculate start of week
        weekStart.setHours(0, 0, 0, 0);
        const startOfTodayTimestamp = admin.firestore.Timestamp.fromDate(todayStart); const startOfWeekTimestamp = admin.firestore.Timestamp.fromDate(weekStart);
        const memberIdsToQuery = memberIds.length > 30 ? memberIds.slice(0, 30) : memberIds; // Handle 'in' query limit
        if (memberIds.length > 30) logger.warn(`Group ${groupId} has ${memberIds.length} members, querying stats only for first 30.`);
        const membersQuery = db.collection("users").where(admin.firestore.FieldPath.documentId(), "in", memberIdsToQuery); const membersSnapshot = await membersQuery.get();
        let activeTodayCount = 0; let newThisWeekCount = 0;
        membersSnapshot.forEach(doc => {
             const userData = doc.data();
             if (userData.lastLogin && userData.lastLogin >= startOfTodayTimestamp) activeTodayCount++;
             // Check createdAt exists and is a Timestamp before comparing
             if (userData.createdAt && userData.createdAt instanceof admin.firestore.Timestamp && userData.createdAt.toDate() >= startOfWeekTimestamp.toDate()) newThisWeekCount++;
             else if (userData.createdAt && !(userData.createdAt instanceof admin.firestore.Timestamp)) logger.warn(`User ${doc.id} has invalid createdAt type:`, userData.createdAt);
        });
        logger.info(`Stats for group ${groupId}: ActiveToday=${activeTodayCount}, NewThisWeek=${newThisWeekCount}`);
        return { activeToday: activeTodayCount, newThisWeek: newThisWeekCount };
    } catch (error) { if (error instanceof HttpsError) { logger.error(`Error getting group stats for ${groupId}: ${error.message}`); throw error; } else { logger.error(`Unexpected error getting group stats for ${groupId}:`, error); throw new HttpsError("internal", "An unexpected error occurred."); } }
}); // <= END OF getGroupStats