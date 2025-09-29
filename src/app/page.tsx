"use client";
import { useEffect, useState } from "react";
import { getFirestore, collection, addDoc, getDocs, Timestamp } from "firebase/firestore";
import { app } from "../../lib/firebase";

const db = getFirestore(app);

type Task = {
  id: string;
  name: string;
  createdAt: Date;
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    const addAndFetch = async () => {
      try {
        // Add test task
        const docRef = await addDoc(collection(db, "testTasks"), {
          name: "Hello Firebase",
          createdAt: new Date(),
        });
        console.log("Document written with ID: ", docRef.id);

        // Fetch tasks
        const querySnapshot = await getDocs(collection(db, "testTasks"));
        const temp: Task[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          temp.push({
            id: doc.id,
            name: data.name,
            createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
          });
        });

        console.log("Fetched tasks:", temp);
        setTasks(temp);
      } catch (e) {
        console.error("Error with Firebase:", e);
      }
    };

    addAndFetch();
  }, []);

  return (
    <main className="p-8">
      <h1 className="text-xl font-bold">Firebase Test</h1>
      <ul>
        {tasks.map((task) => (
          <li key={task.id}>
            {task.name} — {task.createdAt.toLocaleString()}
          </li>
        ))}
      </ul>
    </main>
  );
}
