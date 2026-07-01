import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";
import https from "https";
import { URL } from "url";
import pdfmake from "pdfmake";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ytdl from "@distube/ytdl-core";

const ffmpegPath = ffmpegStatic as unknown as string;
if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}

const app = express();
const PORT = 3000;

app.use(express.json());

// Resolve directory (compatible with both ESM and CJS via process.cwd())
const appCwd = process.cwd();
const uploadDir = path.join(appCwd, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(
      null,
      file.fieldname + "-" + Date.now() + path.extname(file.originalname),
    );
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB limit locally
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
    timeout: 30 * 60 * 1000, // 30 minutes to prevent HeadersTimeoutError for large video processing
  },
});

app.use(express.json());

const PROMPT_SIMPLE = `Realiza una transcripción literal y exacta de todo lo que se habla en el video de principio a fin.
REGLAS ESTRICTAS:
1. Divide la transcripción en párrafos cortos e inserta una marca de tiempo exacta en formato [MM:SS] (ejemplo [01:23]) al inicio de cada nuevo párrafo o cada vez que comience una idea/frase importante.
2. Debe ser una transcripción literal del audio, sin resúmenes, sin explicaciones añadidas, sin análisis clínico extra, sin saludos ni despedidas.
3. El formato de salida debe ser únicamente la transcripción con sus marcas de tiempo [MM:SS] para indexar y facilitar la navegación.`;

const PROMPT_DEEP = `Actúa como un transcriptor médico experto. Realiza una extracción EXHAUSTIVA de este video de forma ESTRICTAMENTE CRONOLÓGICA. Es vital que el texto narrado y la imagen extraída coincidan perfectamente.

REGLAS:
1. ORDEN CRONOLÓGICO: Procesa el video de inicio a fin. Sincroniza perfectamente lo que escuchas con lo que ves en cada instante. No saltes ni agregues información desordenada.
2. TIMESTAMPS EXACTOS DE DIAPOSITIVAS: Cada vez que cambie una diapositiva o comience un tema visual clave, DEBES iniciar tu texto con un timestamp en formato [MM:SS] (ejemplo [04:15]) que represente el segundo exacto en que dicha diapositiva aparece.
3. COHERENCIA AUDIO-VISUAL: Inmediatamente después del timestamp [MM:SS], DEBES describir la diapositiva que está en pantalla EN ESE EXACTO MINUTO Y SEGUNDO, junto con lo que el profesor explica en ese momento. Lo que escribes DEBE pertenecer a esa imagen.
4. EXTRACCIÓN TEXTUAL: Transcribe exactamente tablas, dosis y algoritmos de la imagen actual en el timestamp.
5. Markdown (##, viñetas, **negritas** para patologías y fármacos).
6. NUNCA generes marcas de tiempo al azar ni alucines contenido visual. Mi sistema automatizado tomará una captura de video en el instante [MM:SS] que tú indiques. Si pones un tiempo incorrecto, la captura no coincidirá con tu texto. ¡Sé preciso!`;

const PROMPT_SLIDES = `Actúa como un profesor universitario. Analiza este video y enumera CADA VEZ que cambia la diapositiva en pantalla.
REGLAS:
1. ORDEN CRONOLÓGICO ESTRICTO.
2. Formato por línea: "[MM:SS] - <Título o descripción brevísima de la diapositiva>"
3. NO añadas charla ni transcripción de lo que dice, solo haz un índice de las diapositivas con su marca de tiempo exacta.`;

interface Job {
  status:
    | "pending"
    | "uploading_to_gemini"
    | "processing_video"
    | "generating_analysis"
    | "generating_pdf"
    | "generating_pptx"
    | "complete"
    | "error";
  result?: string;
  pdfUrl?: string; // Add PDF URL
  pptxUrl?: string; // Add PPTX URL
  error?: string;
}

const jobs = new Map<string, Job>();

function parseTimestampToSeconds(ts: string): number {
  const cleanTs = ts.replace(/\[|\]/g, "");
  const parts = cleanTs.split(":").map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

function extractFrameFast(
  videoPath: string,
  timestampSeconds: number,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .inputOptions([`-ss ${timestampSeconds}`])
      .outputOptions(["-vframes 1", "-q:v 2"])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(err))
      .run();
  });
}

function generatePDFWithImages(
  markdownText: string,
  frames: Record<string, string>,
  pdfPath: string,
): Promise<void> {
  pdfmake.setFonts({
    Helvetica: {
      normal: "Helvetica",
      bold: "Helvetica-Bold",
      italics: "Helvetica-Oblique",
      bolditalics: "Helvetica-BoldOblique",
    },
  });

  const content: any[] = [];
  const lines = markdownText.split("\n");

  for (const line of lines) {
    let cleanLine = line.replace(/\*\*/g, "");

    if (cleanLine.trim() === "") {
      content.push({ text: "\n", margin: [0, 5] });
      continue;
    }

    if (cleanLine.startsWith("### ")) {
      content.push({
        text: cleanLine.replace("### ", ""),
        fontSize: 14,
        bold: true,
        margin: [0, 10, 0, 5],
      });
    } else if (cleanLine.startsWith("## ")) {
      content.push({
        text: cleanLine.replace("## ", ""),
        fontSize: 16,
        bold: true,
        margin: [0, 10, 0, 5],
      });
    } else if (cleanLine.startsWith("# ")) {
      content.push({
        text: cleanLine.replace("# ", ""),
        fontSize: 20,
        bold: true,
        margin: [0, 10, 0, 5],
      });
    } else if (cleanLine.startsWith("- ")) {
      content.push({ text: cleanLine, margin: [10, 2, 0, 2] });
    } else {
      content.push({ text: cleanLine, margin: [0, 2] });
    }

    const timeRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
    let match;
    while ((match = timeRegex.exec(line)) !== null) {
      const matchStr = match[1];
      if (frames[matchStr]) {
        content.push({
          image: frames[matchStr],
          width: 500,
          margin: [0, 10, 0, 10],
        });
      }
    }
  }

  const docDefinition = {
    defaultStyle: { font: "Helvetica" },
    content: content,
  };

  return new Promise((resolve, reject) => {
    try {
      pdfmake
        .createPdf(docDefinition as any)
        .write(pdfPath)
        .then(() => resolve())
        .catch(reject);
    } catch (e) {
      reject(e);
    }
  });
}

pdfmake.setFonts({
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
});

function generateSlidesPDF(
  markdownText: string,
  frames: Record<string, string>,
  pdfPath: string,
): Promise<void> {
  const content: any[] = [];
  const lines = markdownText.split("\n");
  const timeRegex = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\] - (.*)$/;

  let firstSlide = true;
  for (const line of lines) {
    const cleanLine = line.trim();
    const match = timeRegex.exec(cleanLine);
    if (match) {
      const ts = match[1];
      const title = match[2];

      if (!firstSlide) {
        content.push({ text: "", pageBreak: "before" });
      }
      firstSlide = false;

      content.push({
        text: `Slide at ${ts}`,
        fontSize: 18,
        bold: true,
        margin: [0, 0, 0, 10],
        color: "#363636",
      });
      if (title && title.trim() !== "") {
        content.push({
          text: title,
          fontSize: 14,
          margin: [0, 0, 0, 20],
          color: "#666666",
        });
      }
      if (frames[ts]) {
        content.push({ image: frames[ts], width: 700, alignment: "center" });
      }
    }
  }

  const docDefinition = {
    pageOrientation: "landscape",
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: "Helvetica" },
    content: content,
  };

  return new Promise((resolve, reject) => {
    try {
      pdfmake
        .createPdf(docDefinition as any)
        .write(pdfPath)
        .then(() => resolve())
        .catch(reject);
    } catch (e) {
      reject(e);
    }
  });
}

const activeUploads = new Map<
  string,
  {
    filepath: string;
    totalChunks: number;
    receivedChunks: number;
  }
>();

app.post("/api/upload/start", (req: Request, res: Response) => {
  const uploadId =
    Date.now().toString() + "-" + Math.random().toString(36).substring(2, 9);
  const filepath = path.join(uploadDir, uploadId + ".tmp");
  activeUploads.set(uploadId, {
    filepath,
    totalChunks: 0,
    receivedChunks: 0,
  });

  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }

  res.json({ uploadId });
});

function downloadFileWithRedirects(
  urlString: string,
  headers: any,
  destPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destPath);

    function download(urlStr: string) {
      try {
        const parsedUrl = new URL(urlStr);
        const req = https.get(parsedUrl, { headers }, (res) => {
          // Handle redirect
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const redirectUrl = res.headers.location;
            res.resume();
            download(redirectUrl);
            return;
          }

          if (res.statusCode !== 200) {
            fileStream.close();
            let body = "";
            res.on("data", (chunk) => {
              body += chunk;
            });
            res.on("end", () => {
              reject(
                new Error(
                  `Download failed: ${res.statusCode} ${res.statusMessage} - ${body}`,
                ),
              );
            });
            return;
          }

          res.pipe(fileStream);

          fileStream.on("finish", () => {
            fileStream.close();
            resolve();
          });

          fileStream.on("error", (err) => {
            fileStream.close();
            fs.unlink(destPath, () => {});
            reject(err);
          });
        });

        req.on("error", (err) => {
          fileStream.close();
          fs.unlink(destPath, () => {});
          reject(err);
        });

        req.end();
      } catch (err) {
        fileStream.close();
        fs.unlink(destPath, () => {});
        reject(err);
      }
    }

    download(urlString);
  });
}

app.post(
  "/api/upload/drive",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { fileId, accessToken, mode, originalname, mimetype } = req.body;

      if (!fileId || !accessToken) {
        res.status(400).json({ error: "Missing Drive parameters" });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({ error: "Gemini API key is not set." });
        return;
      }

      const uploadId =
        Date.now().toString() +
        "-" +
        Math.random().toString(36).substring(2, 9);
      const finalFileName = `${uploadId}-${originalname}`;
      const finalPath = path.join(uploadDir, finalFileName);

      const jobId =
        Date.now().toString() + "-" + Math.random().toString(36).substr(2, 9);
      jobs.set(jobId, { status: "pending" });

      res.json({ complete: true, jobId });

      // Download file from Drive and process in background
      (async () => {
        try {
          jobs.set(jobId, { status: "uploading_to_gemini" });
          // We'll update the status so user knows it's downloading from drive
          // But since we can't add custom statuses without client changes easily,
          // we'll just use 'uploading_to_gemini' to represent both downloading and uploading to Gemini.
          console.log(`[${jobId}] Downloading from Drive: ${fileId}`);

          const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
          const driveHeaders = {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "aistudio-build",
          };

          await downloadFileWithRedirects(driveUrl, driveHeaders, finalPath);

          console.log(
            `[${jobId}] Downloaded from Drive. Starting Gemini Analysis...`,
          );
          startGeminiAnalysis(jobId, finalPath, mimetype, mode);
        } catch (err: any) {
          console.error(`[${jobId}] Error downloading from Drive:`, err);
          jobs.set(jobId, {
            status: "error",
            error: err.message || "Drive download failed",
          });
        }
      })();
    } catch (err: any) {
      console.error("Drive upload initialization error:", err);
      res.status(500).json({ error: "Failed to initialize Drive upload" });
    }
  },
);

app.post(
  "/api/upload/youtube",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { youtubeUrl, mode } = req.body;

      if (!youtubeUrl) {
        res.status(400).json({ error: "Missing YouTube URL" });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({ error: "Gemini API key is not set." });
        return;
      }

      if (!ytdl.validateURL(youtubeUrl)) {
        res.status(400).json({ error: "Invalid YouTube URL" });
        return;
      }

      const uploadId =
        Date.now().toString() +
        "-" +
        Math.random().toString(36).substring(2, 9);
      const finalFileName = `${uploadId}-youtube.mp4`;
      const finalPath = path.join(uploadDir, finalFileName);

      const jobId =
        Date.now().toString() +
        "-" +
        Math.random().toString(36).substring(2, 9);
      jobs.set(jobId, { status: "pending" });

      res.json({ complete: true, jobId });

      // Download file from YouTube and process in background
      (async () => {
        try {
          jobs.set(jobId, { status: "uploading_to_gemini" });
          console.log(`[${jobId}] Downloading from YouTube: ${youtubeUrl}`);

          const videoStream = ytdl(youtubeUrl, {
            quality: "highest",
            filter: "audioandvideo",
          });

          const fileStream = fs.createWriteStream(finalPath);
          videoStream.pipe(fileStream);

          await new Promise((resolve, reject) => {
            fileStream.on("finish", () => resolve(undefined));
            videoStream.on("error", reject);
            fileStream.on("error", reject);
          });

          console.log(
            `[${jobId}] Downloaded from YouTube. Starting Gemini Analysis...`,
          );
          startGeminiAnalysis(jobId, finalPath, "video/mp4", mode);
        } catch (err: any) {
          console.error(`[${jobId}] Error downloading from YouTube:`, err);
          jobs.set(jobId, {
            status: "error",
            error: err.message || "YouTube download failed",
          });
          if (fs.existsSync(finalPath)) {
            fs.unlinkSync(finalPath);
          }
        }
      })();
    } catch (err: any) {
      console.error("YouTube processing initialization error:", err);
      res
        .status(500)
        .json({ error: "Failed to initialize YouTube processing" });
    }
  },
);

app.post(
  "/api/upload/chunk",
  upload.single("chunk"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        uploadId,
        chunkIndex,
        totalChunks,
        mode,
        originalname,
        mimetype,
      } = req.body;
      const chunkFile = req.file;

      if (!uploadId || !chunkFile) {
        res.status(400).json({ error: "Missing parameters" });
        return;
      }

      const uploadRecord = activeUploads.get(uploadId);
      if (!uploadRecord) {
        res.status(404).json({ error: "Upload ID not found" });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({ error: "Gemini API key is not set." });
        return;
      }

      uploadRecord.totalChunks = parseInt(totalChunks);

      const fileBuffer = fs.readFileSync(chunkFile.path);
      fs.appendFileSync(uploadRecord.filepath, fileBuffer);
      fs.unlinkSync(chunkFile.path);

      uploadRecord.receivedChunks++;

      if (uploadRecord.receivedChunks === uploadRecord.totalChunks) {
        const finalFileName = `${uploadId}-${originalname}`;
        const finalPath = path.join(uploadDir, finalFileName);
        fs.renameSync(uploadRecord.filepath, finalPath);
        activeUploads.delete(uploadId);

        const jobId =
          Date.now().toString() + "-" + Math.random().toString(36).substr(2, 9);
        jobs.set(jobId, { status: "pending" });

        startGeminiAnalysis(jobId, finalPath, mimetype, mode);

        res.json({ complete: true, jobId });
      } else {
        res.json({ complete: false });
      }
    } catch (err: any) {
      console.error("Chunk error:", err);
      res.status(500).json({ error: "Chunk upload failed" });
    }
  },
);

async function startGeminiAnalysis(
  jobId: string,
  filepath: string,
  mimetype: string,
  mode: string,
) {
  try {
    jobs.set(jobId, { status: "uploading_to_gemini" });
    const uploadResult = await ai.files.upload({
      file: filepath,
      config: { mimeType: mimetype },
    });
    console.log(`[${jobId}] Uploaded file to Gemini API:`, uploadResult.name);

    jobs.set(jobId, { status: "processing_video" });
    let geminiFile = await ai.files.get({ name: uploadResult.name });
    while (geminiFile.state === "PROCESSING") {
      await new Promise((r) => setTimeout(r, 5000));
      geminiFile = await ai.files.get({ name: uploadResult.name });
    }

    if (geminiFile.state === "FAILED") {
      throw new Error("Video processing failed in Gemini API.");
    }

    jobs.set(jobId, { status: "generating_analysis" });
    let prompt = PROMPT_SIMPLE;
    if (mode === "deep") prompt = PROMPT_DEEP;
    else if (mode === "slides_only") prompt = PROMPT_SLIDES;

    let fullText = "";
    let retries = 0;
    const MAX_RETRIES = 5;

    while (true) {
      try {
        fullText = "";
        const resultStream = await ai.models.generateContentStream({
          model: "gemini-3.5-flash",
          contents: [
            {
              fileData: {
                fileUri: geminiFile.uri,
                mimeType: geminiFile.mimeType,
              },
            },
            prompt,
          ],
        });

        for await (const chunk of resultStream) {
          if (chunk.text) {
            fullText += chunk.text;
          }
        }
        break; // If successful, exit the retry loop
      } catch (error: any) {
        const errorMsg = error?.message || error?.toString() || "";
        const isRetryable =
          error?.code === 503 ||
          error?.code === 429 ||
          errorMsg.includes("503") ||
          errorMsg.includes("429") ||
          error?.status === 503 ||
          error?.status === 429;

        if (isRetryable && retries < MAX_RETRIES) {
          retries++;
          const backoff = 3000 * Math.pow(2, retries);
          console.warn(
            `[${jobId}] Gemini API high demand/quota (503/429). Retrying in ${backoff}ms (Attempt ${retries}/${MAX_RETRIES})...`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoff));
        } else {
          throw error;
        }
      }
    }

    console.log(`[${jobId}] Generation complete.`);

    let pdfUrl: string | undefined = undefined;
    let pptxUrl: string | undefined = undefined;

    if (mode === "deep" || mode === "slides_only") {
      try {
        console.log(`[${jobId}] Extracting frames...`);
        jobs.set(jobId, {
          status: mode === "slides_only" ? "generating_pptx" : "generating_pdf",
        });

        const timeRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
        const uniqueTimestamps = new Set<string>();
        let match;
        while ((match = timeRegex.exec(fullText)) !== null) {
          uniqueTimestamps.add(match[1]);
        }

        const frames: Record<string, string> = {};
        for (const ts of uniqueTimestamps) {
          const seconds = parseTimestampToSeconds(ts);
          const outPath = path.join(uploadDir, `${jobId}_${seconds}.png`);
          await extractFrameFast(filepath, seconds, outPath);
          frames[ts] = outPath;
        }

        if (mode === "deep") {
          const pdfPath = path.join(uploadDir, `${jobId}.pdf`);
          await generatePDFWithImages(fullText, frames, pdfPath);
          pdfUrl = `/api/download/pdf/${jobId}`;
        } else if (mode === "slides_only") {
          const slidesPdfPath = path.join(uploadDir, `${jobId}_slides.pdf`);
          await generateSlidesPDF(fullText, frames, slidesPdfPath);
          pdfUrl = `/api/download/pdf/${jobId}_slides`;
        }

        // Clean up extracted frames
        for (const framePath of Object.values(frames)) {
          if (fs.existsSync(framePath)) fs.unlinkSync(framePath);
        }
      } catch (err) {
        console.error("Failed to generate PDF/PPTX:", err);
      }
    }

    jobs.set(jobId, { status: "complete", result: fullText, pdfUrl, pptxUrl });

    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  } catch (error: any) {
    console.error(`[${jobId}] Error processing background task:`, error);
    jobs.set(jobId, {
      status: "error",
      error: error.message || "Failed to process video.",
    });
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  }
}

app.use("/api/status", (req, res, next) => { console.log("STATUS REQ:", req.method, req.url); next(); });
app.get("/api/status/:jobId", (req: Request, res: Response): void => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

app.get("/api/download/pdf/:jobId", (req: Request, res: Response): void => {
  const jobId = req.params.jobId;
  const pdfPath = path.join(uploadDir, `${jobId}.pdf`);

  if (!fs.existsSync(pdfPath)) {
    res.status(404).json({ error: "PDF not found" });
    return;
  }

  const downloadName = jobId.endsWith("_slides")
    ? "Slides.pdf"
    : "Deep_Clinical_Analysis.pdf";
  res.download(pdfPath, downloadName);
});

app.get("/api/download/pptx/:jobId", (req: Request, res: Response): void => {
  const jobId = req.params.jobId;
  const pptxPath = path.join(uploadDir, `${jobId}.pptx`);

  if (!fs.existsSync(pptxPath)) {
    res.status(404).json({ error: "PPTX not found" });
    return;
  }

  res.download(pptxPath, "Slides.pptx");
});

// JSON Error Handler for Multer or other internal Express errors
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Express Error:", err);
  res.status(500).json({ error: err.message || "Internal Server Error" });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
