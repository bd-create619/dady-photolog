import { useState, useEffect, useMemo } from "react";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  updateDoc,
  query,
  orderBy,
  writeBatch,
} from "firebase/firestore";
import Papa from "papaparse";
import { db } from "./firebase";

// --- ムード（カテゴリ）定義 -----------------------------------------
const MOODS = {
  studio: { label: "スタジオ", color: "#A85D5A" },
  natural: { label: "自然光", color: "#C98A3E" },
  film: { label: "フィルム", color: "#6B6357" },
};

const ADMIN_PASS = "bdsan"; // ▼ 好きなパスワードに変更してください

const PHOTOS_COLLECTION = "photos";

function driveToDirect(url) {
  if (!url) return url;
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  if (m && m[1]) return `https://lh3.googleusercontent.com/d/${m[1]}=w2000`;
  return url;
}

// Firestoreの1ドキュメント上限（1MiB）に収まるよう、少し強めに圧縮します
function compressImage(file, maxWidth = 1100, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function rowsToPhotos(rows) {
  return rows
    .map((row, i) => {
      const date = (row["日付"] || "").trim();
      const place = (row["イベント名"] || "").trim();
      const venue = (row["会場名"] || "").trim();
      const rawUrl = (row["画像URL"] || "").trim();
      if (!date || !place || !rawUrl) return null;
      const moodRaw = (row["ムード"] || "").trim();
      return {
        id: `p${Date.now()}_${i}`,
        date,
        place,
        venue,
        url: driveToDirect(rawUrl),
        camera: (row["使用機材"] || "").trim() || "SONY α6000",
        mood: MOODS[moodRaw] ? moodRaw : "natural",
      };
    })
    .filter(Boolean);
}

function toDateParts(d) {
  const m = String(d).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], da: +m[3] };
}

function fmtDateJP(d) {
  const p = toDateParts(d);
  return p ? `${p.y}年${p.mo}月${p.da}日` : d;
}

function dateSortValue(d) {
  const p = toDateParts(d);
  return p ? p.y * 10000 + p.mo * 100 + p.da : 0;
}

function Sprockets({ count = 6 }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", padding: "10px 0" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ width: 10, height: 7, borderRadius: 2, background: "var(--hole)" }} />
      ))}
    </div>
  );
}

export default function App() {
  const [photos, setPhotos] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [currentEventKey, setCurrentEventKey] = useState(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [passInput, setPassInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [form, setForm] = useState({ place: "", venue: "", date: "", camera: "SONY α6000", mood: "natural" });
  const [adminMode, setAdminMode] = useState("upload");
  const [uploadPreviews, setUploadPreviews] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkResult, setBulkResult] = useState(null);
  const [confirmDeleteEvent, setConfirmDeleteEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editPlace, setEditPlace] = useState("");
  const [editVenue, setEditVenue] = useState("");
  const [shareOpen, setShareOpen] = useState(null); // { url } | null
  const [copied, setCopied] = useState(false);
  const [didParseHash, setDidParseHash] = useState(false);

  // Firestoreをリアルタイム購読（追加・削除・並び替えが自動で全端末に反映されます）
  useEffect(() => {
    const q = query(collection(db, PHOTOS_COLLECTION), orderBy("order", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setPhotos(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoaded(true);
      },
      (err) => {
        console.error(err);
        setLoadError("読み込みに失敗しました。Firebaseの設定（src/firebase.js）とFirestoreのルールをご確認ください。");
        setLoaded(true);
      }
    );
    return () => unsub();
  }, []);

  const eventKeyOf = (p) => `${p.date}__${p.place}`;

  async function addPhotos(entries) {
    try {
      const baseOrder = Date.now();
      let i = 0;
      for (const entry of entries) {
        await setDoc(doc(db, PHOTOS_COLLECTION, entry.id), { ...entry, order: baseOrder + i });
        i++;
      }
      return true;
    } catch (err) {
      console.error("save failed", err);
      return false;
    }
  }

  async function deletePhoto(id) {
    try {
      await deleteDoc(doc(db, PHOTOS_COLLECTION, id));
    } catch (err) {
      console.error("delete failed", err);
    }
  }

  async function deleteEventPhotos(key) {
    const toDelete = photos.filter((p) => eventKeyOf(p) === key);
    setCurrentEventKey(null);
    setConfirmDeleteEvent(false);
    try {
      const batch = writeBatch(db);
      toDelete.forEach((p) => batch.delete(doc(db, PHOTOS_COLLECTION, p.id)));
      await batch.commit();
    } catch (err) {
      console.error("bulk delete failed", err);
    }
  }

  async function updateEventInfo(oldKey, newDate, newPlace, newVenue) {
    const target = photos.filter((p) => eventKeyOf(p) === oldKey);
    try {
      const batch = writeBatch(db);
      target.forEach((p) =>
        batch.update(doc(db, PHOTOS_COLLECTION, p.id), { date: newDate, place: newPlace, venue: newVenue })
      );
      await batch.commit();
    } catch (err) {
      console.error("event update failed", err);
    }
    setCurrentEventKey(`${newDate}__${newPlace}`);
  }

  async function movePhoto(id, direction) {
    const idx = photos.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const target = eventKeyOf(photos[idx]);
    let swapIdx = -1;
    if (direction === "up") {
      for (let i = idx - 1; i >= 0; i--) {
        if (eventKeyOf(photos[i]) === target) {
          swapIdx = i;
          break;
        }
      }
    } else {
      for (let i = idx + 1; i < photos.length; i++) {
        if (eventKeyOf(photos[i]) === target) {
          swapIdx = i;
          break;
        }
      }
    }
    if (swapIdx === -1) return;
    const a = photos[idx];
    const b = photos[swapIdx];
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, PHOTOS_COLLECTION, a.id), { order: b.order });
      batch.update(doc(db, PHOTOS_COLLECTION, b.id), { order: a.order });
      await batch.commit();
    } catch (err) {
      console.error("reorder failed", err);
    }
  }

  function handleAuth() {
    if (passInput === ADMIN_PASS) {
      setAuthed(true);
      setAuthError("");
    } else {
      setAuthError("暗証番号が違います");
    }
  }

  async function handleFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadError("");
    setUploading(true);
    try {
      const dataUrls = [];
      for (const file of files) {
        const dataUrl = await compressImage(file);
        dataUrls.push(dataUrl);
      }
      setUploadPreviews((prev) => [...prev, ...dataUrls]);
    } catch (err) {
      console.error(err);
      setUploadError("画像の読み込みに失敗しました。別の画像でお試しください。");
    } finally {
      setUploading(false);
    }
  }

  function handleRemovePreview(index) {
    setUploadPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleUploadAdd(e) {
    e.preventDefault();
    if (uploadPreviews.length === 0) {
      setUploadError("先に写真を選択してください。");
      return;
    }
    if (!form.place) {
      setUploadError("イベント名を入力してください。");
      return;
    }
    try {
      const baseTime = Date.now();
      const entries = uploadPreviews.map((url, i) => ({
        id: `p${baseTime}_${i}`,
        url,
        place: form.place.trim() || "―",
        venue: form.venue.trim(),
        date: form.date || new Date().toISOString().slice(0, 10),
        camera: form.camera.trim() || "SONY α6000",
        mood: form.mood,
      }));
      const ok = await addPhotos(entries);
      if (!ok) {
        setUploadError("保存に失敗しました。写真が大きすぎる可能性があります。");
        return;
      }
      const newKey = eventKeyOf(entries[0]);
      setUploadPreviews([]);
      setUploadError("");
      setCurrentEventKey(newKey);
      setAdminOpen(false);
    } catch (err) {
      console.error(err);
      setUploadError(`エラーが発生しました: ${err && err.message ? err.message : String(err)}`);
    }
  }

  async function handleBulkImport() {
    if (!bulkText.trim()) return;
    const parsed = Papa.parse(bulkText.trim(), { header: true, skipEmptyLines: true });
    const rows = rowsToPhotos(parsed.data);
    if (rows.length === 0) {
      setBulkResult({ ok: false, message: "取り込める行がありませんでした。見出し行（日付・イベント名・画像URL）と中身をご確認ください。" });
      return;
    }
    const ok = await addPhotos(rows);
    if (!ok) {
      setBulkResult({ ok: false, message: "保存に失敗しました。もう一度お試しください。" });
      return;
    }
    setBulkResult({ ok: true, message: `${rows.length}件を追加しました。` });
    setBulkText("");
  }

  const events = useMemo(() => {
    const map = new Map();
    for (const p of photos) {
      const key = eventKeyOf(p);
      if (!map.has(key)) map.set(key, { key, date: p.date, place: p.place, venue: p.venue, photos: [] });
      map.get(key).photos.push(p);
    }
    return Array.from(map.values()).sort((a, b) => dateSortValue(b.date) - dateSortValue(a.date));
  }, [photos]);

  const currentEvent = events.find((e) => e.key === currentEventKey) || null;

  useEffect(() => {
    if (currentEventKey && !events.find((e) => e.key === currentEventKey)) {
      setCurrentEventKey(null);
    }
  }, [events, currentEventKey]);

  // URLの#event=... を読み取って、該当ページを直接開けるようにする（共有リンク対応）
  useEffect(() => {
    if (didParseHash || !loaded) return;
    const hash = window.location.hash;
    if (hash.startsWith("#event=")) {
      const key = decodeURIComponent(hash.slice(7));
      if (events.find((e) => e.key === key)) {
        setCurrentEventKey(key);
      }
    }
    setDidParseHash(true);
  }, [loaded, events, didParseHash]);

  // 案件ページの行き来に合わせてURLを更新（共有・ブックマーク用）
  useEffect(() => {
    if (!didParseHash) return;
    const base = window.location.pathname + window.location.search;
    if (currentEventKey) {
      window.history.replaceState(null, "", base + "#event=" + encodeURIComponent(currentEventKey));
    } else {
      window.history.replaceState(null, "", base);
    }
  }, [currentEventKey, didParseHash]);

  function openShareTop() {
    const url = window.location.origin + window.location.pathname;
    setCopied(false);
    setShareOpen({ url, label: "このアルバム全体" });
  }

  function openShareEvent(key) {
    const url = window.location.origin + window.location.pathname + "#event=" + encodeURIComponent(key);
    setCopied(false);
    setShareOpen({ url, label: "この案件のページ" });
  }

  async function copyShareUrl() {
    try {
      await navigator.clipboard.writeText(shareOpen.url);
      setCopied(true);
    } catch (e) {
      // クリップボードAPIが使えない場合のフォールバック
      const ta = document.createElement("textarea");
      ta.value = shareOpen.url;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
      } catch (err) {
        console.error(err);
      }
      document.body.removeChild(ta);
    }
  }

  return (
    <div style={{ background: "var(--wall)", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@500;700&family=Noto+Sans+JP:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }

        .pg-root {
          --wall: #CFC6B8;
          --mat: #EDE6D8;
          --ink: #2B2622;
          --ink-dim: #756B5E;
          --rose: #A85D5A;
          --amber: #C98A3E;
          --hole: #E7DFCF;
          font-family: 'Noto Sans JP', sans-serif;
          color: var(--ink);
        }
        .pg-serif { font-family: 'Shippori Mincho', serif; }
        .pg-mono { font-family: 'IBM Plex Mono', monospace; }

        .pg-frame { display: flex; background: var(--mat); border-radius: 2px; box-shadow: 0 10px 24px -12px rgba(43,38,34,0.35), 0 1px 0 rgba(255,255,255,0.4) inset; margin-bottom: 22px; overflow: hidden; }
        .pg-strip { width: 26px; background: var(--ink); flex-shrink: 0; position: relative; }
        .pg-strip .pg-code { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-90deg); white-space: nowrap; font-size: 9px; letter-spacing: 0.12em; color: var(--hole); }
        .pg-body { flex: 1; padding: 14px 16px 16px; display: flex; flex-direction: column; }
        .pg-img-wrap { overflow: hidden; border-radius: 1px; }
        .pg-img-wrap img { display: block; width: 100%; height: auto; }
        .pg-caption { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 12px; gap: 10px; }
        .pg-no { font-size: 10px; color: var(--ink-dim); letter-spacing: 0.1em; }

        .pg-event-card { display: flex; align-items: center; gap: 14px; width: 100%; background: var(--mat); border: none; border-radius: 3px; padding: 12px; margin-bottom: 12px; cursor: pointer; text-align: left; box-shadow: 0 6px 16px -10px rgba(43,38,34,0.3); }
        .pg-event-thumb { width: 64px; height: 64px; flex-shrink: 0; border-radius: 2px; overflow: hidden; background: var(--ink); }
        .pg-event-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .pg-event-text { flex: 1; color: var(--ink); }
      `}</style>

      <div className="pg-root">
        <header style={{ padding: "26px 20px 6px", textAlign: "center" }}>
          <div className="pg-mono" style={{ fontSize: 10, color: "var(--ink-dim)", letterSpacing: "0.25em" }}>
            PORTRAIT SITTINGS
          </div>
          <h1 className="pg-serif" style={{ fontSize: 34, fontWeight: 700, margin: "4px 0 2px", letterSpacing: "0.05em" }}>
            ダディのフォトlog
          </h1>
          <div style={{ fontSize: 12, color: "var(--ink-dim)" }}>a private album of portraits</div>
        </header>

        {loadError && (
          <div className="pg-mono" style={{ maxWidth: 640, margin: "16px auto 0", padding: "10px 16px", fontSize: 11, color: "var(--rose)", border: "1px solid var(--rose)", borderRadius: 4, textAlign: "center" }}>
            ⚠ {loadError}
          </div>
        )}

        {currentEvent ? (
          <>
            <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 20px 4px" }}>
              <button
                onClick={() => {
                  setConfirmDeleteEvent(false);
                  setEditingEvent(false);
                  setCurrentEventKey(null);
                }}
                className="pg-mono"
                style={{ background: "none", border: "none", color: "var(--ink-dim)", fontSize: 12, cursor: "pointer", padding: 0, marginBottom: 14 }}
              >
                ← 一覧へ戻る
              </button>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
                {editingEvent ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                    <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={inputStyle} />
                    <input value={editPlace} onChange={(e) => setEditPlace(e.target.value)} placeholder="イベント名" style={inputStyle} />
                    <input value={editVenue} onChange={(e) => setEditVenue(e.target.value)} placeholder="会場名" style={inputStyle} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => {
                          updateEventInfo(currentEvent.key, editDate, editPlace.trim() || currentEvent.place, editVenue.trim());
                          setEditingEvent(false);
                        }}
                        className="pg-mono"
                        style={{ fontSize: 11, color: "#EDE6D8", background: "var(--ink)", border: "none", borderRadius: 4, padding: "5px 10px", cursor: "pointer" }}
                      >
                        保存
                      </button>
                      <button onClick={() => setEditingEvent(false)} className="pg-mono" style={{ fontSize: 11, color: "var(--ink-dim)", background: "none", border: "1px solid var(--ink-dim)", borderRadius: 4, padding: "5px 10px", cursor: "pointer" }}>
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div className="pg-serif" style={{ fontSize: 24, fontWeight: 700 }}>
                        {fmtDateJP(currentEvent.date)}　{currentEvent.place}
                      </div>
                      {authed && (
                        <button
                          onClick={() => {
                            setEditDate(currentEvent.date);
                            setEditPlace(currentEvent.place);
                            setEditVenue(currentEvent.venue || "");
                            setEditingEvent(true);
                          }}
                          className="pg-mono"
                          style={{ fontSize: 10, color: "var(--ink-dim)", background: "none", border: "1px solid var(--ink-dim)", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }}
                        >
                          編集
                        </button>
                      )}
                    </div>
                    {currentEvent.venue && (
                      <div className="pg-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 2 }}>
                        会場：{currentEvent.venue}
                      </div>
                    )}
                    <div className="pg-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>
                      {currentEvent.photos.length}枚
                    </div>
                  </div>
                )}
                {authed && !editingEvent &&
                  (confirmDeleteEvent ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span className="pg-mono" style={{ fontSize: 10.5, color: "var(--rose)" }}>本当に削除？</span>
                      <button onClick={() => deleteEventPhotos(currentEvent.key)} className="pg-mono" style={{ fontSize: 11, color: "#fff", background: "var(--rose)", border: "none", borderRadius: 4, padding: "5px 10px", cursor: "pointer" }}>
                        削除する
                      </button>
                      <button onClick={() => setConfirmDeleteEvent(false)} className="pg-mono" style={{ fontSize: 11, color: "var(--ink-dim)", background: "none", border: "1px solid var(--ink-dim)", borderRadius: 4, padding: "5px 10px", cursor: "pointer" }}>
                        キャンセル
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmDeleteEvent(true)} className="pg-mono" style={{ fontSize: 11, color: "var(--rose)", background: "none", border: "1px solid var(--rose)", borderRadius: 4, padding: "5px 10px", cursor: "pointer", whiteSpace: "nowrap" }}>
                      案件をまとめて削除
                    </button>
                  ))}
              </div>
            </div>

            <main style={{ maxWidth: 720, margin: "0 auto", padding: "16px 20px 50px" }}>
              {currentEvent.photos.map((p) => {
                const frameNo = String(currentEvent.photos.indexOf(p) + 1).padStart(3, "0");
                return (
                  <div className="pg-frame" key={p.id}>
                    <div className="pg-strip">
                      <Sprockets count={7} />
                      <div className="pg-code pg-mono">{p.camera}</div>
                    </div>
                    <div className="pg-body">
                      <div className="pg-img-wrap">
                        <img src={p.url} alt={p.place} loading="lazy" />
                      </div>
                      <div className="pg-caption" style={{ justifyContent: "flex-end" }}>
                        <div style={{ textAlign: "right" }}>
                          <div className="pg-no pg-mono">Nº {frameNo}</div>
                          {authed && (
                            <div style={{ display: "flex", gap: 4, marginTop: 6, justifyContent: "flex-end" }}>
                              <button onClick={() => movePhoto(p.id, "up")} disabled={currentEvent.photos.indexOf(p) === 0} className="pg-mono" style={{ fontSize: 10, color: "var(--ink-dim)", background: "none", border: "1px solid var(--ink-dim)", borderRadius: 4, padding: "2px 6px", cursor: "pointer", opacity: currentEvent.photos.indexOf(p) === 0 ? 0.35 : 1 }}>↑</button>
                              <button onClick={() => movePhoto(p.id, "down")} disabled={currentEvent.photos.indexOf(p) === currentEvent.photos.length - 1} className="pg-mono" style={{ fontSize: 10, color: "var(--ink-dim)", background: "none", border: "1px solid var(--ink-dim)", borderRadius: 4, padding: "2px 6px", cursor: "pointer", opacity: currentEvent.photos.indexOf(p) === currentEvent.photos.length - 1 ? 0.35 : 1 }}>↓</button>
                              <button onClick={() => deletePhoto(p.id)} className="pg-mono" style={{ fontSize: 10, color: "var(--rose)", background: "none", border: "1px solid var(--rose)", borderRadius: 4, padding: "2px 7px", cursor: "pointer" }}>削除</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button
                  onClick={() => openShareEvent(currentEvent.key)}
                  className="pg-mono"
                  style={{ fontSize: 11, color: "var(--ink-dim)", background: "var(--mat)", border: "1px solid var(--ink-dim)", borderRadius: 20, padding: "8px 18px", cursor: "pointer" }}
                >
                  🔗 この案件を共有
                </button>
              </div>
            </main>
          </>
        ) : (
          <main style={{ maxWidth: 640, margin: "0 auto", padding: "18px 20px 50px" }}>
            {!loaded ? (
              <div className="pg-mono" style={{ color: "var(--ink-dim)", padding: "40px 0", textAlign: "center" }}>読み込み中...</div>
            ) : events.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "var(--ink-dim)" }}>
                まだ撮影案件がありません。右下の鍵アイコンから追加できます。
              </div>
            ) : (
              events.map((ev) => (
                <button key={ev.key} onClick={() => setCurrentEventKey(ev.key)} className="pg-event-card">
                  <div className="pg-event-thumb">
                    <img src={ev.photos[0].url} alt="" loading="lazy" />
                  </div>
                  <div className="pg-event-text">
                    <div className="pg-serif" style={{ fontSize: 17 }}>{fmtDateJP(ev.date)}　{ev.place}</div>
                    {ev.venue && <div className="pg-mono" style={{ fontSize: 10.5, color: "var(--ink-dim)", marginTop: 2 }}>{ev.venue}</div>}
                    <div className="pg-mono" style={{ fontSize: 11, color: "var(--ink-dim)", marginTop: 4 }}>{ev.photos.length}枚</div>
                  </div>
                  <div className="pg-mono" style={{ color: "var(--ink-dim)", fontSize: 16 }}>›</div>
                </button>
              ))
            )}
            {loaded && events.length > 0 && (
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button
                  onClick={openShareTop}
                  className="pg-mono"
                  style={{ fontSize: 11, color: "var(--ink-dim)", background: "var(--mat)", border: "1px solid var(--ink-dim)", borderRadius: 20, padding: "8px 18px", cursor: "pointer" }}
                >
                  🔗 このアルバムを共有
                </button>
              </div>
            )}
          </main>
        )}

        <footer className="pg-mono" style={{ textAlign: "center", padding: "6px 0 30px", fontSize: 10.5, color: "var(--ink-dim)" }}>
          Shot on Sony α6000 ／ BD PHOTO
        </footer>

        <button
          onClick={() => {
            if (currentEvent) setForm((f) => ({ ...f, date: currentEvent.date, place: currentEvent.place, venue: currentEvent.venue || "" }));
            setAdminOpen(true);
          }}
          style={{ position: "fixed", right: 16, bottom: 16, width: 40, height: 40, borderRadius: "50%", background: "var(--ink)", border: "none", color: "var(--mat)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 6px 16px -6px rgba(0,0,0,0.4)" }}
        >
          ⚙
        </button>

        {adminOpen && (
          <div style={{ position: "fixed", inset: 0, background: "#2B2622aa", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }} onClick={() => setAdminOpen(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--mat)", borderRadius: 6, width: "100%", maxWidth: 400, padding: 22, maxHeight: "90vh", overflowY: "auto" }}>
              {!authed ? (
                <>
                  <div className="pg-serif" style={{ fontWeight: 700, marginBottom: 12, fontSize: 18 }}>管理者ログイン</div>
                  <input type="password" value={passInput} onChange={(e) => setPassInput(e.target.value)} placeholder="暗証番号" style={inputStyle} />
                  {authError && <div style={{ color: "#A85D5A", fontSize: 12, margin: "8px 0" }}>{authError}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={handleAuth} style={primaryBtn}>ログイン</button>
                    <button onClick={() => setAdminOpen(false)} style={secondaryBtn}>閉じる</button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                    <button onClick={() => setAdminMode("upload")} style={{ flex: 1, padding: 8, borderRadius: 4, fontSize: 12, cursor: "pointer", border: "1px solid var(--ink)", background: adminMode === "upload" ? "var(--ink)" : "none", color: adminMode === "upload" ? "var(--mat)" : "var(--ink)" }}>写真をアップロード</button>
                    <button onClick={() => setAdminMode("bulk")} style={{ flex: 1, padding: 8, borderRadius: 4, fontSize: 12, cursor: "pointer", border: "1px solid var(--ink)", background: adminMode === "bulk" ? "var(--ink)" : "none", color: adminMode === "bulk" ? "var(--mat)" : "var(--ink)" }}>まとめて貼り付け</button>
                  </div>

                  {adminMode === "upload" ? (
                    <>
                      <div className="pg-serif" style={{ fontWeight: 700, marginBottom: 12, fontSize: 18 }}>写真を追加</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <input type="file" accept="image/*" multiple onChange={handleFileSelect} style={{ fontSize: 13 }} />
                        {uploading && <div className="pg-mono" style={{ fontSize: 11, color: "var(--ink-dim)" }}>画像を処理中...</div>}
                        {uploadError && <div style={{ fontSize: 12, color: "var(--rose)" }}>{uploadError}</div>}
                        {uploadPreviews.length > 0 && (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                            {uploadPreviews.map((src, i) => (
                              <div key={i} style={{ position: "relative" }}>
                                <img src={src} alt={`プレビュー${i + 1}`} style={{ width: "100%", height: 70, objectFit: "cover", borderRadius: 4, display: "block" }} />
                                <button type="button" onClick={() => handleRemovePreview(i)} style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%", background: "var(--ink)", color: "var(--mat)", border: "none", fontSize: 11, lineHeight: "18px", padding: 0, cursor: "pointer" }}>×</button>
                              </div>
                            ))}
                          </div>
                        )}
                        {uploadPreviews.length > 0 && <div className="pg-mono" style={{ fontSize: 10.5, color: "var(--ink-dim)" }}>{uploadPreviews.length}枚選択中</div>}
                        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={inputStyle} />
                        <input placeholder="イベント名（例：HQS LIVE）" value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} style={inputStyle} />
                        <input placeholder="会場名（例：自由が丘）" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} style={inputStyle} />
                        <input placeholder="使用機材（例：SONY α6000）" value={form.camera} onChange={(e) => setForm({ ...form, camera: e.target.value })} style={inputStyle} />
                        <select value={form.mood} onChange={(e) => setForm({ ...form, mood: e.target.value })} style={inputStyle}>
                          {Object.entries(MOODS).map(([key, m]) => (
                            <option key={key} value={key}>{m.label}</option>
                          ))}
                        </select>
                        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                          <button type="button" onClick={handleUploadAdd} style={primaryBtn}>追加する</button>
                          <button type="button" onClick={() => setAdminOpen(false)} style={secondaryBtn}>閉じる</button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="pg-serif" style={{ fontWeight: 700, marginBottom: 6, fontSize: 18 }}>まとめて貼り付け</div>
                      <div className="pg-mono" style={{ fontSize: 10.5, color: "var(--ink-dim)", marginBottom: 10, lineHeight: 1.6 }}>
                        Googleスプレッドシートで1行目に見出し（日付／イベント名／会場名／画像URL／使用機材／ムード）を作り、見出し行を含めて範囲選択→コピー（Ctrl+C）。下の欄にそのまま貼り付けてください。
                      </div>
                      <textarea
                        value={bulkText}
                        onChange={(e) => setBulkText(e.target.value)}
                        placeholder={"日付\tイベント名\t会場名\t画像URL\t使用機材\tムード\n2026-06-02\tHQS LIVE\t自由が丘\thttps://drive.google.com/...\tSONY α6000\tstudio"}
                        rows={7}
                        style={{ ...inputStyle, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, resize: "vertical" }}
                      />
                      {bulkResult && <div style={{ fontSize: 12, marginTop: 8, color: bulkResult.ok ? "#5B7A4A" : "var(--rose)" }}>{bulkResult.message}</div>}
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button onClick={handleBulkImport} style={primaryBtn}>取り込む</button>
                        <button type="button" onClick={() => setAdminOpen(false)} style={secondaryBtn}>閉じる</button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* 共有ポップアップ */}
        {shareOpen && (
          <div
            style={{ position: "fixed", inset: 0, background: "#2B2622aa", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 60 }}
            onClick={() => setShareOpen(null)}
          >
            <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--mat)", borderRadius: 6, width: "100%", maxWidth: 380, padding: 22 }}>
              <div className="pg-serif" style={{ fontWeight: 700, marginBottom: 6, fontSize: 17 }}>リンクを共有</div>
              <div className="pg-mono" style={{ fontSize: 10.5, color: "var(--ink-dim)", marginBottom: 10 }}>{shareOpen.label}のリンクです</div>
              <input
                readOnly
                value={shareOpen.url}
                onFocus={(e) => e.target.select()}
                style={{ ...inputStyle, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button onClick={copyShareUrl} style={primaryBtn}>
                  {copied ? "コピーしました ✓" : "リンクをコピーする"}
                </button>
                <button onClick={() => setShareOpen(null)} style={secondaryBtn}>閉じる</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle = { width: "100%", padding: 10, borderRadius: 4, border: "1px solid #75705f55", background: "#F5F1E8", color: "#2B2622", fontSize: 14 };
const primaryBtn = { flex: 1, padding: 10, borderRadius: 4, background: "#2B2622", color: "#EDE6D8", fontWeight: 700, border: "none", cursor: "pointer" };
const secondaryBtn = { padding: 10, borderRadius: 4, background: "none", border: "1px solid #75705f55", color: "#756B5E", cursor: "pointer" };
