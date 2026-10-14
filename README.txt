============================================================
  CLICK & READ  -  འ་དོམ་དང་བྱི་ལི།
  Every word is clickable and plays its own audio.
============================================================

OPEN IT
-------
Double-click index.html (works in Chrome / Edge). To share with
students, upload the whole folder to Netlify Drop, GitHub Pages or
your school portal.

HOW THE AUDIO WORKS (3 steps)
-----------------------------
There are 94 different words in the story (135 clickable words,
because some repeat). Each word has a file name: w01 ... w94.

  1. Open audio/WORD-LIST.txt  (or word-list.csv in Excel).
     It shows which word is w01, w02, w03 ...
  2. Record each word and save it as an MP3 with that name:
        audio/w01.mp3   audio/w02.mp3   ...
     A word that repeats (e.g. བྱི་ལི) is recorded only ONCE.
  3. Put the MP3 files in the audio/ folder. Done - clicking the
     word now plays your voice.

Until a word has audio, clicking it shows a small shake and stays
silent (Dzongkha has no computer voice, so we do not use one).

ALTERNATIVE: RECORD INSIDE THE APP
----------------------------------
Teacher Mode -> click a word -> Record -> Stop. It is saved in that
browser only. Use Export / Import to move recordings to other
computers. (For all students to hear it, use the MP3 files above.)

BUTTONS
-------
Read All  - highlights and plays the whole story word by word.
Speed     - 0.5x / 0.75x / 1x playback.
Progress  - bar fills as students click words.

CHANGING THE TEXT OR WORD SPLITS
--------------------------------
Open lessons.js. Each word is { t:"text", k:"w05" }.
Words that share the same k share the same audio file.
Teacher Mode -> "Add a new lesson" also accepts pasted Dzongkha
(each space-separated chunk becomes a clickable word).

FONT NOTE
---------
The page loads the Jomolhari font from Google Fonts. Without
internet it falls back to a Dzongkha font installed on the
device (Noto Serif Tibetan, Microsoft Himalaya, etc.).
