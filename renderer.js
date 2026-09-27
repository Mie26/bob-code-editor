const state = {
  filePath: null,
  fileName: "untitled.py",
  // Mémorise, pour chaque ligne actuellement commentée par Bob, à quoi
  // ressemblait le CODE de cette ligne (sans le commentaire) au moment où
  // le commentaire a été ajouté. Sert à détecter qu'une ligne a été
  // modifiée/effacée pour retirer aussitôt son commentaire devenu obsolète.
  commentedLines: {}
};

const codeEditor = document.getElementById("codeEditor");
const lineNumbers = document.getElementById("lineNumbers");
const mirror = document.getElementById("mirror");
const libraries = document.getElementById("libraries");
const errors = document.getElementById("errors");
const terminalOutput = document.getElementById("terminalOutput");
const terminalInput = document.getElementById("terminalInput");
const statusMessage = document.getElementById("statusMessage");

// Marqueur invisible (largeur nulle) placé juste après le symbole de
// commentaire pour chaque commentaire ajouté par Bob. Permet de retrouver
// et de retirer précisément CES commentaires-là plus tard, sans jamais
// toucher à un commentaire que l'utilisateur aurait écrit lui-même.
const BOB_COMMENT_MARKER = "\u200B";
const BOB_COMMENT_REGEX = /[ \t]*(#|\/\/|\/\*|<!--)[ \t]*\u200B.*$/;

// Retire, ligne par ligne, tout commentaire précédemment ajouté par Bob.
// Utilisé avant chaque nouvelle analyse pour repartir d'un code "propre"
// et éviter que les commentaires ne s'empilent d'une analyse à l'autre.
function stripBobComments(sourceCode) {
  return sourceCode
    .split("\n")
    .map(line => line.replace(BOB_COMMENT_REGEX, ""))
    .join("\n");
}

function setText(element, html) {
  element.innerHTML = html;
}

// ============================================================
// Symbole de commentaire selon le langage du fichier ouvert.
// Evite d'ecrire "//" (JS) dans un fichier Python, par exemple.
// ============================================================
function getCommentToken(fileName) {
  const ext = (fileName || "").split(".").pop().toLowerCase();
  const map = {
    py: "#",
    js: "//",
    ts: "//",
    jsx: "//",
    tsx: "//",
    java: "//",
    c: "//",
    cpp: "//",
    cs: "//",
    css: "/*", // pas de commentaire mono-ligne en CSS, voir applyInlineComments
    html: "<!--"
  };
  return map[ext] || "#";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateFileName(name) {
  state.fileName = name || "untitled.py";
  document.getElementById("fileTitle").textContent = state.fileName;
  document.getElementById("tabName").textContent = state.fileName;
  document.getElementById("sidebarFile").textContent = `  ◻ ${state.fileName}`;
}

function updateLineNumbers() {
  const count = Math.max(1, codeEditor.value.split("\n").length);
  lineNumbers.textContent = Array.from(
    { length: count },
    (_, i) => i + 1
  ).join("\n");
  lineNumbers.scrollTop = codeEditor.scrollTop;
}

function newFile() {
  if (codeEditor.value.trim()) {
    const confirmed = window.confirm(
      "Le contenu actuel sera remplacé. Continuer ?"
    );
    if (!confirmed) return;
  }

  codeEditor.value = "";
  state.filePath = null;
  state.commentedLines = {};
  updateFileName("untitled.py");
  clearAnalysis();
  setStatus("Nouveau fichier");
  updateLineNumbers();
}

async function openFile() {
  try {
    const result = await window.bobDesktop.openFile();
    if (!result) return;

    codeEditor.value = result.content;
    state.filePath = result.filePath;
    state.commentedLines = {};
    updateFileName(result.fileName);
    clearAnalysis();
    updateLineNumbers();
    setStatus(`Ouvert : ${result.fileName}`);
  } catch (error) {
    window.alert(`Impossible d'ouvrir le fichier.\n${error.message}`);
  }
}

async function saveFile() {
  try {
    const result = await window.bobDesktop.saveFile({
      filePath: state.filePath,
      fileName: state.fileName,
      content: codeEditor.value
    });

    if (!result) return;

    state.filePath = result.filePath;
    updateFileName(result.fileName);
    setStatus(`Sauvegardé : ${result.fileName}`);
    writeTerminal(`✓ Fichier sauvegardé : ${result.filePath}`);
  } catch (error) {
    window.alert(`Impossible de sauvegarder le fichier.\n${error.message}`);
  }
}

function clearAnalysis() {
  state.commentedLines = {};
  setText(
    mirror,
    '<div class="empty-state">Clique sur <b>Analyser avec Bob</b> pour obtenir les explications.</div>'
  );
  setText(
    libraries,
    '<div class="empty-state">Les imports détectés apparaîtront ici.</div>'
  );
  setText(
    errors,
    '<div class="empty-state">Les erreurs et corrections proposées apparaîtront ici.</div>'
  );
}

async function analyzeWithBob() {
  const rawSource = codeEditor.value;

  if (!rawSource.trim()) {
    window.alert("Écris ou ouvre du code avant de lancer l'analyse.");
    return;
  }

  // On repart toujours d'un code "propre", sans les commentaires que Bob
  // aurait ajoutés lors d'une analyse précédente : sinon ils s'empilent
  // d'une analyse à l'autre et Bob finit par commenter ses propres
  // commentaires au lieu du vrai code.
  const source = stripBobComments(rawSource);

  setText(mirror, '<div class="empty-state">⏳ Bob analyse ton code...</div>');
  setText(libraries, '<div class="empty-state">⏳ En attente de Bob...</div>');
  setText(errors, '<div class="empty-state">⏳ En attente de Bob...</div>');
  setStatus("Bob : analyse en cours...");
  writeTerminal("✦ Envoi du code à Bob Shell...");

  try {
    const result = await window.bobDesktop.analyzeWithBob(source);

    if (!result.success) {
      setText(mirror, `<div class="empty-state" style="color:#f48771">❌ Erreur : ${escapeHtml(result.error)}</div>`);
      setStatus("Bob : erreur");
      writeTerminal(`❌ Erreur : ${result.error}`);
      return;
    }

    // 1. Extraire le message de Bob depuis le JSON
    let bobMessage = result.raw;
    try {
      const parsed = JSON.parse(result.raw.trim());
      bobMessage = parsed.last_message || result.raw;
    } catch (e) {}

    // 2. Découper la réponse en 4 sections
    const sections = splitBobSections(bobMessage);

    // 3. Zone 1 : remplacer le code par la version AVEC commentaires inline
    //    (toujours basée sur le code nettoyé, jamais sur l'ancien texte
    //    qui pouvait encore contenir des commentaires précédents)
    if (sections.comments && sections.comments.trim()) {
      const commentToken = getCommentToken(state.fileName);
      const commentedCode = applyInlineComments(source, sections.comments, commentToken);
      if (commentedCode) {
        codeEditor.value = commentedCode;
        updateLineNumbers();
        updateCommentedLinesTracking(source, commentedCode);
        writeTerminal("✓ Commentaires inline ajoutés dans le code");
      } else if (source !== rawSource) {
        codeEditor.value = source;
        updateLineNumbers();
        state.commentedLines = {};
      }
    } else if (source !== rawSource) {
      // Bob n'a rien fourni comme commentaires cette fois : on garde au
      // moins le code nettoyé des anciens commentaires, pour ne laisser
      // aucune trace obsolète dans l'éditeur.
      codeEditor.value = source;
      updateLineNumbers();
      state.commentedLines = {};
    }

    // 4. Zone 2 : Explications → Miroir
    setText(
      mirror,
      sections.explanations && sections.explanations.trim()
        ? formatLines(sections.explanations)
        : '<div class="empty-state">Aucune explication reçue.</div>'
    );

    // 5. Zone 3 : Bibliothèques
    // On ne fait jamais disparaître le panneau : s'il n'y a rien à dire,
    // on garde le même message vide qu'au départ, sans rien déplacer.
    const librariesHtml = sections.libraries && sections.libraries.trim()
      ? formatLibraries(sections.libraries)
      : "";
    setText(
      libraries,
      librariesHtml.trim()
        ? librariesHtml
        : '<div class="empty-state">Aucune bibliothèque détectée.</div>'
    );

    // 6. Zone 4 : Erreurs / Corrections
    const errorsHtml = sections.errors && sections.errors.trim()
      ? formatErrors(sections.errors)
      : "";
    setText(
      errors,
      errorsHtml.trim()
        ? errorsHtml
        : '<div class="empty-state">Aucune erreur détectée.</div>'
    );

    setStatus("Bob : analyse terminée");
    writeTerminal("✓ Analyse terminée");

  } catch (err) {
    setText(mirror, `<div class="empty-state" style="color:#f48771">❌ Erreur : ${escapeHtml(err.message)}</div>`);
    setStatus("Bob : erreur");
    writeTerminal(`❌ Erreur : ${err.message}`);
  }
}

// ============================================================
// Suivi des lignes commentées par Bob (pour pouvoir les invalider
// automatiquement dès que le CODE de la ligne change).
// ============================================================
function updateCommentedLinesTracking(cleanSource, commentedCode) {
  const cleanLines = cleanSource.split("\n");
  const commentedLines = commentedCode.split("\n");
  const map = {};

  for (let i = 0; i < commentedLines.length; i++) {
    if (commentedLines[i].includes(BOB_COMMENT_MARKER)) {
      map[i] = cleanLines[i] !== undefined ? cleanLines[i] : "";
    }
  }

  state.commentedLines = map;
}

// Appelé à chaque frappe : si le code d'une ligne commentée par Bob a
// changé (ou a été effacé) depuis l'ajout du commentaire, on retire ce
// commentaire immédiatement, sans attendre une nouvelle analyse.
function liveStripStaleComments() {
  const trackedLines = Object.keys(state.commentedLines);
  if (trackedLines.length === 0) return;

  const lines = codeEditor.value.split("\n");
  let changed = false;

  for (const key of trackedLines) {
    const lineIndex = Number(key);
    const line = lines[lineIndex];

    if (line === undefined || !line.includes(BOB_COMMENT_MARKER)) {
      // La ligne a disparu ou son commentaire a déjà été retiré à la main.
      delete state.commentedLines[key];
      continue;
    }

    const currentCodePart = line.replace(BOB_COMMENT_REGEX, "");
    if (currentCodePart !== state.commentedLines[key]) {
      // Le code de cette ligne ne correspond plus à ce qu'il était quand
      // Bob l'a commentée : le commentaire n'a plus de sens, on l'efface
      // avec lui, sans laisser de trace.
      lines[lineIndex] = currentCodePart.replace(/[ \t]+$/, "");
      delete state.commentedLines[key];
      changed = true;
    }
  }

  if (changed) {
    const selStart = codeEditor.selectionStart;
    const selEnd = codeEditor.selectionEnd;
    codeEditor.value = lines.join("\n");
    const maxPos = codeEditor.value.length;
    codeEditor.setSelectionRange(Math.min(selStart, maxPos), Math.min(selEnd, maxPos));
  }
}

// ============================================================
// Découper la réponse de Bob en 4 sections
// ============================================================
function splitBobSections(text) {
  const result = { comments: "", explanations: "", libraries: "", errors: "" };

  const regex = /===\s*(.+?)\s*===([\s\S]*?)(?====|$)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const title = match[1].toUpperCase();
    const content = match[2].trim();

    if (title.includes("COMMENTAIRE")) {
      result.comments = content;
    } else if (title.includes("EXPLICATION") || title.includes("MIROIR")) {
      result.explanations = content;
    } else if (title.includes("BIBLIOTH")) {
      result.libraries = content;
    } else if (title.includes("ERREUR") || title.includes("CORRECTION")) {
      result.errors = content;
    }
  }

  // Si aucun marqueur trouvé, on met tout dans explanations
  if (!result.explanations && !result.libraries && !result.errors && !result.comments) {
    result.explanations = text;
  }

  return result;
}

// ============================================================
// Appliquer les commentaires inline dans le code source (zone 1)
// ============================================================
function applyInlineComments(sourceCode, commentsText, commentToken) {
  const token = commentToken || "#";
  const isBlockStyle = token === "/*" || token === "<!--";
  const sourceLines = sourceCode.split("\n");
  const commentMap = {};

  const lines = commentsText.split("\n");
  for (const line of lines) {
    const m = line.match(/^(?:Ligne\s+)?(\d+)\s*:\s*(.+)$/i);
    if (m) {
      const lineNum = parseInt(m[1], 10);
      let comment = m[2].trim();
      // On retire tout symbole de commentaire que Bob aurait ajouté
      // lui-même (#, //, /* */, <!-- -->) pour ne pas le dupliquer.
      comment = comment
        .replace(/^#+\s*/, "")
        .replace(/^\/\/+\s*/, "")
        .replace(/^\/\*+\s*/, "")
        .replace(/\*+\/\s*$/, "")
        .replace(/^<!--+\s*/, "")
        .replace(/--+>\s*$/, "")
        .trim();

      // Limiter à 6 mots maximum
      const words = comment.split(/\s+/).filter(Boolean);
      if (words.length > 6) {
        comment = words.slice(0, 6).join(" ");
      }
      // Une ligne vide dans le source ne doit jamais recevoir de
      // commentaire : ça n'aurait aucun sens et casserait l'alignement.
      if (comment && sourceLines[lineNum - 1] !== undefined && sourceLines[lineNum - 1].trim() !== "") {
        commentMap[lineNum] = comment;
      }
    }
  }

  if (Object.keys(commentMap).length === 0) {
    return null;
  }

  // Créer un affichage avec commentaires alignés à droite
  const maxLineLength = Math.max(...sourceLines.map(l => l.length), 40);

  return sourceLines.map((line, index) => {
    const lineNum = index + 1;
    const comment = commentMap[lineNum];
    if (!comment) return line;

    const padding = " ".repeat(Math.max(2, maxLineLength - line.length + 2));
    if (isBlockStyle) {
      const close = token === "/*" ? "*/" : "-->";
      return `${line}${padding}${token} ${BOB_COMMENT_MARKER}${comment} ${close}`;
    }
    return `${line}${padding}${token} ${BOB_COMMENT_MARKER}${comment}`;
  }).join("\n");
}

// ============================================================
// Formater les explications (zone Miroir)
// ============================================================
function formatLines(text) {
  const lines = text.split("\n").filter(l => l.trim());
  return lines.map(line => {
    const match = line.match(/^(?:Ligne\s+)?(\d+)\s*:\s*(.+)$/i);
    if (match) {
      return `<div class="line-explanation"><span class="line-label">Ligne ${match[1]}</span>${escapeHtml(match[2])}</div>`;
    }
    return `<div class="line-explanation">${escapeHtml(line)}</div>`;
  }).join("");
}

// ============================================================
// Formater les bibliothèques (zone Bibliothèques)
// ============================================================
function formatLibraries(text) {
  const lines = text.split("\n").filter(l => l.trim());
  return lines.map(line => {
    const clean = line.replace(/^[-•*]\s*/, "").trim();
    if (!clean) return "";
    return `<div class="library-item">📦 ${escapeHtml(clean)}</div>`;
  }).join("");
}

// ============================================================
// Formater les erreurs (zone Erreurs)
// ============================================================
function formatErrors(text) {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length === 0) {
    return '<div class="empty-state">Aucune erreur détectée.</div>';
  }
  return lines.map(line => {
    const match = line.match(/^Ligne\s+(\d+)\s*:\s*(.+)$/i);
    if (match) {
      return `<div class="error-item"><strong>Ligne ${match[1]}</strong> : ${escapeHtml(match[2])}</div>`;
    }
    const correction = line.match(/^Correction\s*:\s*(.+)$/i);
    if (correction) {
      return `<div class="error-item"><span class="correction">✓ ${escapeHtml(correction[1])}</span></div>`;
    }
    return `<div class="error-item">${escapeHtml(line)}</div>`;
  }).join("");
}

// ============================================================
// Terminal
// ============================================================
function writeTerminal(message) {
  const div = document.createElement("div");
  div.textContent = message;
  terminalOutput.appendChild(div);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function setStatus(message) {
  statusMessage.textContent = message;
}

function clearTerminal() {
  terminalOutput.innerHTML = "";
}

async function runTerminal() {
  const command = terminalInput.value.trim();
  if (!command) return;

  writeTerminal(`› ${command}`);
  terminalInput.value = "";

  const runButton = document.getElementById("runTerminal");
  runButton.disabled = true;
  setStatus("Exécution en cours...");

  // Si un fichier est ouvert, on lance la commande depuis son dossier.
  // Cela permet par exemple de faire "python script.py" sans changer
  // manuellement de dossier dans le terminal.
  let cwd = null;
  if (state.filePath) {
    const separator = Math.max(state.filePath.lastIndexOf("\\"), state.filePath.lastIndexOf("/"));
    if (separator >= 0) cwd = state.filePath.slice(0, separator);
  }

  try {
    const result = await window.bobDesktop.executeCommand({ command, cwd });

    if (result.stdout) {
      result.stdout.split(/\r?\n/).forEach(line => {
        if (line !== "") writeTerminal(line);
      });
    }

    if (result.stderr) {
      result.stderr.split(/\r?\n/).forEach(line => {
        if (line !== "") writeTerminal(`⚠ ${line}`);
      });
    }

    if (result.success) {
      writeTerminal(`✓ Terminé (code ${result.exitCode})`);
      setStatus("Commande terminée");
    } else {
      writeTerminal(`❌ Commande échouée (code ${result.exitCode})`);
      if (result.error && !result.stderr) writeTerminal(`❌ ${result.error}`);
      setStatus("Erreur d'exécution");
    }
  } catch (error) {
    writeTerminal(`❌ Impossible d'exécuter la commande : ${error.message}`);
    setStatus("Erreur d'exécution");
  } finally {
    runButton.disabled = false;
    terminalInput.focus();
  }
}

// ============================================================
// Événements
// ============================================================
document.getElementById("newBtn").addEventListener("click", newFile);
document.getElementById("openBtn").addEventListener("click", openFile);
document.getElementById("saveBtn").addEventListener("click", saveFile);
document.getElementById("analyzeBtn").addEventListener("click", analyzeWithBob);
document.getElementById("clearTerminal").addEventListener("click", clearTerminal);
document.getElementById("runTerminal").addEventListener("click", runTerminal);

terminalInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") runTerminal();
});

codeEditor.addEventListener("input", () => {
  liveStripStaleComments();
  updateLineNumbers();
});
codeEditor.addEventListener("scroll", () => {
  lineNumbers.scrollTop = codeEditor.scrollTop;
});

codeEditor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = codeEditor.selectionStart;
    const end = codeEditor.selectionEnd;
    codeEditor.setRangeText("    ", start, end, "end");
    updateLineNumbers();
  }
});

window.addEventListener("resize", updateLineNumbers);
updateLineNumbers();