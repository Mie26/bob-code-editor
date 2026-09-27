const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const { exec } = require("child_process");
const os = require("os");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1100,
    minHeight: 650,
    backgroundColor: "#181818",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("file:open", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Code", extensions: ["py", "js", "ts", "html", "css", "json", "txt"] },
      { name: "Tous les fichiers", extensions: ["*"] }
    ]
  });

  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];
  const content = await fs.readFile(filePath, "utf8");

  return {
    filePath,
    content,
    fileName: path.basename(filePath)
  };
});

ipcMain.handle("terminal:execute", async (_event, data) => {
  const command = String(data?.command || "").trim();
  if (!command) {
    return { success: false, error: "Aucune commande à exécuter." };
  }

  // Le terminal doit s'exécuter dans le dossier du fichier courant lorsque
  // celui-ci existe, sinon dans le dossier du projet Electron.
  let cwd = __dirname;
  if (data?.cwd) {
    try {
      const candidate = path.resolve(String(data.cwd));
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) cwd = candidate;
    } catch (_) {
      // Si le dossier n'existe plus, on utilise le dossier du projet.
    }
  }

  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        shell: process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "/bin/sh",
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120000
      },
      (error, stdout, stderr) => {
        const exitCode = typeof error?.code === "number" ? error.code : 0;
        resolve({
          success: !error,
          stdout: stdout || "",
          stderr: stderr || "",
          exitCode,
          error: error ? error.message : ""
        });
      }
    );
  });
});

ipcMain.handle("file:save", async (_event, data) => {
  let filePath = data.filePath;

  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: data.fileName || "untitled.py",
      filters: [
        { name: "Python", extensions: ["py"] },
        { name: "JavaScript", extensions: ["js"] },
        { name: "HTML", extensions: ["html"] },
        { name: "Tous les fichiers", extensions: ["*"] }
      ]
    });

    if (result.canceled || !result.filePath) return null;
    filePath = result.filePath;
  }

  await fs.writeFile(filePath, data.content, "utf8");

  return {
    filePath,
    fileName: path.basename(filePath)
  };
});

// ============================================================
// HANDLER BOB : analyse le code via Bob Shell
// ============================================================
// ============================================================
// HANDLER BOB : analyse le code via Bob Shell
// ============================================================
ipcMain.handle("bob:analyze", async (_event, code) => {
  return new Promise((resolve) => {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    // 1. Nettoyer le code SANS detruire sa structure (on garde les
    //    retours a la ligne et l'indentation : Bob doit voir le meme
    //    decoupage en lignes que l'editeur, sinon sa numerotation
    //    "Ligne N" ne correspond plus au vrai fichier).
    const cleanCode = code
      .replace(/\r\n/g, "\n")
      .replace(/[^\x09\x0A\x20-\x7E]/g, "") // retire les caracteres non imprimables, garde \t et \n
      .replace(/[ \t]+$/gm, ""); // retire les espaces de fin de ligne

    // 2. On numerote nous-memes chaque ligne du fichier et on fournit
    //    cette numerotation a Bob : il n'a plus qu'a la recopier telle
    //    quelle, il n'a plus besoin (et n'a plus le droit) de recompter.
    const numberedLines = cleanCode
      .split("\n")
      .map((line, i) => `${i + 1}: ${line}`)
      .join("\n");

    // 3. Prompt simple
    const prompt = `Analyse ce code Python. Reponds EXACTEMENT dans ce format, sans rien ajouter avant ou apres :

=== COMMENTAIRES INLINE ===
Ligne 1 : commentaire de 3 a 6 mots maximum
Ligne 2 : commentaire de 3 a 6 mots maximum
...

=== EXPLICATIONS ===
Ligne 1 : explication detaillee et pedagogique de la ligne
Ligne 2 : explication detaillee et pedagogique de la ligne
...

=== BIBLIOTHEQUES ===
- nom_bibliotheque : raison
...

=== ERREURS ET CORRECTIONS ===
Ligne X : description de l'erreur
Correction : code corrige
...

Regles strictes et IMPERATIVES sur la numerotation :
- Le code ci-dessous est deja numerote ligne par ligne, au format "N: contenu".
  Cette numerotation N correspond exactement aux vraies lignes du fichier
  dans l'editeur.
- Tu DOIS reutiliser ces memes numeros N tels quels dans "Ligne N : ...".
  Ne renumerote jamais toi-meme et ne saute aucune ligne dans ta numerotation.
- Le commentaire ou l'explication donnes pour "Ligne N" doivent parler
  uniquement de ce qui se passe SUR CETTE LIGNE N precise (pas d'une autre
  ligne). Si une ligne est vide ou ne contient qu'un commentaire existant,
  ne produis pas de "Ligne N" pour elle.
- N'ecris jamais "N:" (le prefixe de numerotation fourni) dans tes
  commentaires ou explications, il sert uniquement de repere.

Regles strictes et IMPERATIVES de separation des 4 sections (tres important,
ne les melange JAMAIS) :
- Dans "COMMENTAIRES INLINE" et dans "EXPLICATIONS", decris UNIQUEMENT ce que
  la ligne est censee faire (son fonctionnement normal, pedagogique). N'y
  mentionne JAMAIS un bug, une erreur, un argument manquant, une exception,
  ou tout probleme : meme si tu en detectes un, decris la ligne comme si le
  code etait correct.
- Toute erreur, bug, argument manquant, faute de syntaxe ou probleme logique
  que tu detectes DOIT etre signale UNIQUEMENT dans la section
  "ERREURS ET CORRECTIONS", jamais ailleurs.
- Tu dois TOUJOURS ecrire les 4 en-tetes ("=== ... ===") dans cet ordre,
  meme si une section n'a rien a contenir : dans ce cas laisse-la
  completement vide juste apres son en-tete (aucune ligne, pas de "aucun(e)",
  pas de "RAS"), mais garde quand meme l'en-tete lui-meme.
- Si le code n'a besoin d'aucune bibliotheque externe, laisse
  "=== BIBLIOTHEQUES ===" vide. Si le code n'a aucune erreur, laisse
  "=== ERREURS ET CORRECTIONS ===" vide.

Autres regles :
- Les commentaires inline font MAXIMUM 6 mots, ne commencent ni par # ni par //.
- Les explications sont longues et detaillees (2-3 phrases).
- N'utilise pas de Markdown.

Code a analyser (deja numerote ligne par ligne) :
${numberedLines}`;
    // 3. Écrire le prompt dans un fichier temporaire
    const tmpFile = path.join(os.tmpdir(), `bob-prompt-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt, "utf8");

    // 3.bis Forcer une session Bob neuve à chaque analyse.
    //      Le CLI "bob" garde par défaut le contexte de la conversation
    //      précédente d'un appel à l'autre (dossier bob_sessions/), ce qui
    //      peut le faire halluciner sur l'ancien code au lieu du nouveau.
    //      On réinitialise ce dossier de session avant chaque appel pour
    //      garantir une analyse toujours fraîche, indépendante des
    //      précédentes.
    try {
      const sessionsDir = path.join(process.cwd(), "bob_sessions");
      if (fs.existsSync(sessionsDir)) {
        fs.rmSync(sessionsDir, { recursive: true, force: true });
      }
    } catch (e) {
      // pas bloquant : si on ne peut pas nettoyer, on continue quand même
    }

    // 4. Commande PowerShell qui lit le fichier et le passe à Bob
    //    Le chemin du fichier est échappé pour PowerShell
    const escapedTmp = tmpFile.replace(/\\/g, "\\\\");
    const psCommand = `powershell -NoProfile -Command "$env:BOB_API_KEY='${process.env.BOB_API_KEY || ""}'; Get-Content -Raw '${tmpFile}' | bob --accept-license run --format json --trust"`;

    exec(
      psCommand,
      {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 180000,
        shell: "cmd.exe"
      },
      (error, stdout, stderr) => {
        try { fs.unlinkSync(tmpFile); } catch (e) {}

        if (error) {
          resolve({ success: false, error: error.message, stderr: stderr, stdout: stdout });
          return;
        }
        resolve({ success: true, raw: stdout, stderr: stderr });
      }
    );
  });
});