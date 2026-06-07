import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDNgEvxzmr-OjzrHdL8PdesxPdgK0D7T5M",
  authDomain: "reha-manager.firebaseapp.com",
  projectId: "reha-manager",
  storageBucket: "reha-manager.firebasestorage.app",
  messagingSenderId: "36535727619",
  appId: "1:36535727619:web:b30dddfb06883143934036",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);

export default app;