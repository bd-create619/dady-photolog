import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ▼▼▼ ここをFirebaseコンソールで取得した自分の設定値に置き換えてください ▼▼▼
// Firebaseコンソール → プロジェクトの設定 → 全般 → マイアプリ → 「SDK の設定と構成」
// の「構成」を選ぶと、この形のオブジェクトが表示されます。
const firebaseConfig = {
  apiKey: "AIzaSyA7od_DzOHYJn4iEL3ld1f_93ov5gGJljk",
  authDomain: "daddy-photolog.firebaseapp.com",
  projectId: "daddy-photolog",
  storageBucket: "daddy-photolog.firebasestorage.app",
  messagingSenderId: "1020694822789",
  appId: "1:1020694822789:web:e4996df0fdf7ebb23c0eec",
};
// ▲▲▲ ここまで ▲▲▲

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
