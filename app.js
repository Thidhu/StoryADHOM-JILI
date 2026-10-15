/* ============================================================
   Click & Read — main application logic
   Sound priority: 1) teacher recording (IndexedDB)
                   2) audio/<key>.mp3 file in audio/ folder
                   3) browser text-to-speech (only if lesson.tts !== false)
   ============================================================ */
(function () {
  "use strict";

  // ---------- State ----------
  var state = "idle";            // idle | playing | recording
  var currentLesson = null;
  var playQueueTimer = null;
  var stopRequested = false;
  var currentAudio = null;       // active Audio element (recording/file)
  var mediaRecorder = null;
  var recordedChunks = [];
  var practised = JSON.parse(localStorage.getItem("cr_practised") || "[]");

  // ---------- DOM ----------
  var $ = function (id) { return document.getElementById(id); };
  var readingArea = $("readingArea");
  var lessonSelect = $("lessonSelect");
  var speedSelect = $("speedSelect");
  var playAllBtn = $("playAllBtn");
  var stopBtn = $("stopBtn");
  var teacherBtn = $("teacherBtn");
  var teacherPanel = $("teacherPanel");
  var practisedCount = $("practisedCount");
  var progressBar = $("progressBar");
  var lessonTitleEl = $("lessonTitle");
  var filePlayer = $("filePlayer");

  // ---------- IndexedDB (recordings) ----------
  var DB_NAME = "ClickReadDB", STORE = "sounds";
  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function dbKey(lang, key) { return (lang || "x") + ":" + String(key).toLowerCase(); }
  function saveRecording(lang, key, blob) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(blob, dbKey(lang, key));
        tx.oncomplete = function () { resolve(); refreshDots(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function getRecording(lang, key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).get(dbKey(lang, key));
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    });
  }
  function deleteRecording(lang, key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(dbKey(lang, key));
        tx.oncomplete = function () { resolve(); refreshDots(); };
      });
    });
  }
  function getAllRecordings() {
    return openDB().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).getAllKeys();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { resolve([]); };
      });
    });
  }

  // ---------- Lessons (built-in + user-added) ----------
  function getUserLessons() {
    try { return JSON.parse(localStorage.getItem("cr_user_lessons") || "[]"); }
    catch (e) { return []; }
  }
  function saveUserLessons(list) {
    localStorage.setItem("cr_user_lessons", JSON.stringify(list));
  }
  function allLessons() { return getUserLessons().concat(window.LESSONS || []); }

  function populateLessonSelect() {
    var lessons = allLessons();
    lessonSelect.innerHTML = "";
    lessons.forEach(function (l) {
      var opt = document.createElement("option");
      opt.value = l.id; opt.textContent = l.title;
      lessonSelect.appendChild(opt);
    });
    if (currentLesson) lessonSelect.value = currentLesson.id;
  }

  // Parse pasted text into lesson lines.
  // Dzongkha/Tibetan: every space-separated chunk is one clickable word.
  // Other languages: words, with hyphenated words split into syllables.
  function parseLessonText(text, lang) {
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
    var isTib = lang === "dz";
    return lines.map(function (line) {
      var tokens = [];
      var parts = line.match(/[^\s]+|\s+/g) || [];
      parts.forEach(function (part) {
        if (/^\s+$/.test(part)) { tokens.push({ t: " " }); return; }
        if (isTib) {
          var m = part.match(/^(.*?)([\u0F0D\u0F0E?!]+)$/);
          var word = m ? m[1] : part, p = m ? m[2] : "";
          if (word) tokens.push({ t: word, k: word.replace(/\u0F0B+$/, "") });
          if (p) tokens.push({ t: p, punct: true });
          return;
        }
        var sub = part.split(/(-)/g).filter(function (s) { return s.length > 0; });
        sub.forEach(function (s) {
          if (s === "-") { tokens.push({ t: "-", punct: true }); return; }
          var m2 = s.match(/^([\w'\u2019]+)([.,!?;:]*)$/);
          if (m2) {
            tokens.push({ t: m2[1], k: m2[1].toLowerCase() });
            if (m2[2]) tokens.push({ t: m2[2], punct: true });
          } else {
            tokens.push({ t: s, punct: true });
          }
        });
      });
      return tokens.filter(function (t, i, arr) { return !(t.t === " " && (i === 0 || i === arr.length - 1)); });
    });
  }

  // ---------- Rendering ----------
  function renderLesson(lesson) {
    currentLesson = lesson;
    lessonTitleEl.textContent = lesson.title;
    readingArea.innerHTML = "";
    readingArea.classList.toggle("is-dz", lesson.lang === "dz");
    lesson.lines.forEach(function (lineTokens, lineIdx) {
      var p = document.createElement("p");
      p.className = "lesson-line" + (lineIdx < (lesson.titleLines || 0) ? " title-line" : "");
      lineTokens.forEach(function (tok) {
        if (tok.t === " ") {
          var sp = document.createElement("span");
          sp.className = "space"; sp.textContent = " ";
          p.appendChild(sp); return;
        }
        if (tok.punct) {
          var pu = document.createElement("span");
          pu.className = "punct"; pu.textContent = tok.t;
          p.appendChild(pu); return;
        }
        var span = document.createElement("span");
        span.className = "tok";
        span.textContent = tok.t;
        span.dataset.key = tok.k || tok.t.toLowerCase();
        span.dataset.lang = lesson.lang;
        span.dataset.text = tok.t;
        var dot = document.createElement("span");
        dot.className = "src-dot"; dot.style.display = "none";
        span.appendChild(dot);
        if (practised.indexOf(span.dataset.key) !== -1) span.classList.add("practised");
        span.addEventListener("click", function () {
          if (teacherPanel.classList.contains("hidden") === false) {
            $("recordKey").value = span.dataset.key;
            $("recWord").textContent = span.dataset.text + "   \u2192   audio/" + span.dataset.key + ".mp3";
          }
          playToken(span);
        });
        p.appendChild(span);
      });
      readingArea.appendChild(p);
    });
    refreshDots();
    updateProgress();
    if (window.lucide) lucide.createIcons();
  }

  function refreshDots() {
    var toks = readingArea.querySelectorAll(".tok");
    toks.forEach(function (el) {
      var dot = el.querySelector(".src-dot");
      getRecording(el.dataset.lang, el.dataset.key).then(function (blob) {
        if (blob) { dot.style.display = "block"; dot.style.background = "var(--accent)"; }
      });
    });
  }

  function markPractised(key) {
    if (practised.indexOf(key) === -1) {
      practised.push(key);
      localStorage.setItem("cr_practised", JSON.stringify(practised));
    }
    var els = readingArea.querySelectorAll('.tok[data-key="' + key + '"]');
    els.forEach(function (e) { e.classList.add("practised"); });
    updateProgress();
  }

  function updateProgress() {
    practisedCount.textContent = practised.length;
    var keys = {};
    readingArea.querySelectorAll(".tok").forEach(function (el) { keys[el.dataset.key] = 1; });
    var total = Object.keys(keys).length;
    var done = Object.keys(keys).filter(function (k) { return practised.indexOf(k) !== -1; }).length;
    progressBar.style.width = total ? Math.round(done / total * 100) + "%" : "0%";
  }

  // ---------- Playback ----------
  function getSpeed() { return parseFloat(speedSelect.value) || 1; }

  function speakTTS(text, lang) {
    return new Promise(function (resolve) {
      if (!("speechSynthesis" in window)) { resolve(); return; }
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = lang || "en-US";
      u.rate = getSpeed();
      u.onend = function () { resolve(); };
      u.onerror = function () { resolve(); };
      window.speechSynthesis.speak(u);
    });
  }

  function playBlob(blob) {
    return new Promise(function (resolve, reject) {
      stopCurrentAudio();
      var url = URL.createObjectURL(blob);
      var a = new Audio(url);
      a.playbackRate = getSpeed();
      currentAudio = a;
      a.onended = function () { URL.revokeObjectURL(url); currentAudio = null; resolve(); };
      a.onerror = function () { URL.revokeObjectURL(url); currentAudio = null; reject(); };
      a.play().catch(function () { currentAudio = null; reject(); });
    });
  }

  function playFile(key) {
    return new Promise(function (resolve, reject) {
      stopCurrentAudio();
      filePlayer.src = "audio/" + encodeURIComponent(key) + ".mp3";
      filePlayer.playbackRate = getSpeed();
      currentAudio = filePlayer;
      var onEnd = function () { cleanup(); resolve(); };
      var onErr = function () { cleanup(); reject(); };
      function cleanup() {
        filePlayer.removeEventListener("ended", onEnd);
        filePlayer.removeEventListener("error", onErr);
        currentAudio = null;
      }
      filePlayer.addEventListener("ended", onEnd);
      filePlayer.addEventListener("error", onErr);
      filePlayer.play().catch(function () { cleanup(); reject(); });
    });
  }

  function stopCurrentAudio() {
    if (currentAudio) {
      try { currentAudio.pause(); } catch (e) {}
      if (currentAudio !== filePlayer) { try { currentAudio.src = ""; } catch (e) {} }
      currentAudio = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  // No recording and no mp3: use the computer voice only if the lesson allows it.
  // (Dzongkha has no computer voice, so it stays silent instead of mispronouncing.)
  function fallbackVoice(el, dot, lang) {
    if (currentLesson && currentLesson.tts === false) {
      el.classList.remove("noaudio"); void el.offsetWidth; el.classList.add("noaudio");
      return new Promise(function (r) { setTimeout(function () { r("none"); }, 650); });
    }
    return speakTTS(el.textContent, lang).then(function () {
      dot.style.display = "block"; dot.style.background = "#94a3b8";
      return "tts";
    });
  }

  // Play a token; returns promise that resolves when sound ends.
  function playToken(el) {
    return new Promise(function (resolve) {
      var key = el.dataset.key, lang = el.dataset.lang;
      el.classList.add("playing");
      var dot = el.querySelector(".src-dot");

      getRecording(lang, key).then(function (blob) {
        if (blob) {
          dot.style.display = "block"; dot.style.background = "var(--accent)";
          return playBlob(blob).then(function () { return "rec"; });
        }
        return playFile(key).then(function () {
          dot.style.display = "block"; dot.style.background = "var(--accent2)";
          return "file";
        }).catch(function () { return fallbackVoice(el, dot, lang); });
      }).catch(function () { return fallbackVoice(el, dot, lang); }).then(function () {
        el.classList.remove("playing");
        markPractised(key);
        resolve();
      });
    });
  }

  function stopAll() {
    stopRequested = true;
    stopCurrentAudio();
    if (playQueueTimer) { clearTimeout(playQueueTimer); playQueueTimer = null; }
    readingArea.querySelectorAll(".tok.playing").forEach(function (e) { e.classList.remove("playing"); });
    state = "idle";
  }

  // Read entire lesson sequentially
  function readAll() {
    if (state === "playing") return;
    state = "playing"; stopRequested = false;
    var tokens = Array.prototype.slice.call(readingArea.querySelectorAll(".tok"));
    var i = 0;
    function next() {
      if (stopRequested || i >= tokens.length) { state = "idle"; return; }
      var el = tokens[i++];
      playToken(el).then(function () {
        // small pause between words
        playQueueTimer = setTimeout(next, 120);
      });
    }
    next();
  }

  // ---------- Teacher: recording ----------
  var recStatus = $("recStatus");
  function setRecStatus(msg, isError) {
    recStatus.textContent = msg;
    recStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
  }

  function startRecording() {
    var key = $("recordKey").value.trim().toLowerCase();
    if (!key) { setRecStatus("Type a word key first (e.g. kha), or click a word in the lesson.", true); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRecStatus("Recording not supported in this browser. Try Chrome or Edge.", true); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recordedChunks = [];
      try { mediaRecorder = new MediaRecorder(stream); }
      catch (e) { setRecStatus("MediaRecorder not supported.", true); return; }
      mediaRecorder.ondataavailable = function (e) { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        saveRecording(currentLesson ? currentLesson.lang : "en", key, blob).then(function () {
          setRecStatus("Saved recording for '" + key + "'. Click the word to hear it.");
        });
      };
      mediaRecorder.start();
      state = "recording";
      $("recordBtn").classList.add("hidden");
      $("stopRecBtn").classList.remove("hidden");
      $("recordBtn").classList.add("recording");
      setRecStatus("Recording... speak clearly, then press Stop.");
    }).catch(function () {
      setRecStatus("Microphone permission denied. Allow mic access in your browser.", true);
    });
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    state = "idle";
    $("recordBtn").classList.remove("hidden", "recording");
    $("stopRecBtn").classList.add("hidden");
  }

  function playRecorded() {
    var key = $("recordKey").value.trim().toLowerCase();
    if (!key || !currentLesson) { setRecStatus("Type a word key first.", true); return; }
    getRecording(currentLesson.lang, key).then(function (blob) {
      if (!blob) { setRecStatus("No recording found for '" + key + "'.", true); return; }
      playBlob(blob);
      setRecStatus("Playing recording for '" + key + "'.");
    });
  }

  function deleteRecorded() {
    var key = $("recordKey").value.trim().toLowerCase();
    if (!key || !currentLesson) return;
    deleteRecording(currentLesson.lang, key).then(function () {
      setRecStatus("Deleted recording for '" + key + "'.");
    });
  }

  // ---------- Teacher: add lesson ----------
  function addLesson() {
    var title = $("newLessonTitle").value.trim();
    var lang = $("newLessonLang").value;
    var text = $("newLessonText").value.trim();
    if (!title || !text) { alert("Please fill in both title and text."); return; }
    var id = "user-" + Date.now();
    var lesson = { id: id, title: title, lang: lang, lines: parseLessonText(text, lang), tts: lang !== "dz", userCreated: true };
    var list = getUserLessons();
    list.unshift(lesson);
    saveUserLessons(list);
    populateLessonSelect();
    lessonSelect.value = id;
    renderLesson(lesson);
    $("newLessonTitle").value = ""; $("newLessonText").value = "";
    setRecStatus("Lesson added. Click any word to record its sound.");
  }

  // ---------- Export / Import recordings ----------
  function exportRecordings() {
    openDB().then(function (db) {
      var tx = db.transaction(STORE, "readonly");
      var store = tx.objectStore(STORE);
      var data = {};
      store.openCursor().onsuccess = function (e) {
        var cursor = e.target.result;
        if (cursor) {
          var blob = cursor.value;
          var reader = new FileReader();
          reader.onloadend = function () {
            data[cursor.key] = { mime: blob.type, b64: reader.result.split(",")[1] };
            if (Object.keys(data).length === expected) {
              var blobOut = new Blob([JSON.stringify(data)], { type: "application/json" });
              var a = document.createElement("a");
              a.href = URL.createObjectURL(blobOut);
              a.download = "click-and-read-recordings.json";
              a.click();
            }
          };
          reader.readAsDataURL(blob);
          cursor.continue();
        }
      };
      var expected = 0;
      store.count().onsuccess = function (e) { expected = e.target.result; if (expected === 0) setRecStatus("No recordings to export.", true); };
    });
  }

  function importRecordings(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var keys = Object.keys(data);
        var done = 0;
        keys.forEach(function (k) {
          var item = data[k];
          var binary = atob(item.b64);
          var arr = new Uint8Array(binary.length);
          for (var i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
          var blob = new Blob([arr], { type: item.mime || "audio/webm" });
          openDB().then(function (db) {
            var tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put(blob, k);
            tx.oncomplete = function () {
              done++;
              if (done === keys.length) {
                setRecStatus("Imported " + keys.length + " recording(s).");
                refreshDots();
              }
            };
          });
        });
      } catch (e) {
        setRecStatus("Import failed: invalid file.", true);
      }
    };
    reader.readAsText(file);
  }

  // ---------- Events ----------
  lessonSelect.addEventListener("change", function () {
    stopAll();
    var lessons = allLessons();
    var l = lessons.filter(function (x) { return x.id === lessonSelect.value; })[0];
    if (l) renderLesson(l);
  });
  playAllBtn.addEventListener("click", readAll);
  stopBtn.addEventListener("click", stopAll);
  teacherBtn.addEventListener("click", function () {
    teacherPanel.classList.toggle("hidden");
    teacherBtn.classList.toggle("btn-primary");
    teacherBtn.classList.toggle("btn-ghost");
    if (window.lucide) lucide.createIcons();
  });
  $("recordBtn").addEventListener("click", startRecording);
  $("stopRecBtn").addEventListener("click", stopRecording);
  $("playRecBtn").addEventListener("click", playRecorded);
  $("delRecBtn").addEventListener("click", deleteRecorded);
  $("addLessonBtn").addEventListener("click", addLesson);
  $("exportBtn").addEventListener("click", exportRecordings);
  $("importInput").addEventListener("change", function (e) {
    if (e.target.files[0]) importRecordings(e.target.files[0]);
  });
  $("resetProgressBtn").addEventListener("click", function () {
    if (confirm("Reset all practised-word progress?")) {
      practised = []; localStorage.removeItem("cr_practised");
      readingArea.querySelectorAll(".tok").forEach(function (e) { e.classList.remove("practised"); });
      updateProgress();
    }
  });

  // ---------- Opening scene ----------
  (function () {
    var splash = $("splash");
    if (!splash) return;
    var timer = null, closed = false;
    function toStep2() {
      if (closed || splash.classList.contains("step2")) return;
      clearTimeout(timer);
      splash.classList.remove("step1"); splash.classList.add("step2");
    }
    function closeSplash() {
      if (closed) return; closed = true; clearTimeout(timer);
      splash.classList.add("leaving");
      setTimeout(function () { splash.style.display = "none"; }, 650);
    }
    splash.classList.add("step1");
    timer = setTimeout(toStep2, 2800);
    $("splashBrand").addEventListener("click", toStep2);
    $("startBtn").addEventListener("click", closeSplash);
    $("skipSplash").addEventListener("click", closeSplash);
  })();

  // ---------- Init ----------
  populateLessonSelect();
  var first = allLessons()[0];
  if (first) renderLesson(first);
  if (window.lucide) lucide.createIcons();
})();
