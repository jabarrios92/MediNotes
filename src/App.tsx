import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import {
  UploadCloud,
  FileVideo,
  FileText,
  Activity,
  AlertCircle,
  Download,
  Copy,
  Mail,
  Clock,
  File,
  Monitor,
  Video,
  CheckCircle2,
  ChevronRight,
  X,
} from "lucide-react";
import { GoogleDriveUpload } from "./GoogleDriveUpload";

interface VideoMetadata {
  duration?: number;
  width?: number;
  height?: number;
  size?: number;
}

const safeJson = async (res: Response, endpoint: string) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(
      "Invalid JSON from " + endpoint + ":",
      text.substring(0, 100),
    );
    throw new Error("Invalid JSON from " + endpoint + ". HTML returned?");
  }
};

export default function App() {
  const [youtubeUrl, setYoutubeUrl] = useState<string>("");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [driveFile, setDriveFile] = useState<
    | ({
        id: string;
        name: string;
        mimeType: string;
        token: string;
      } & VideoMetadata)
    | null
  >(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(
    null,
  );
  const [mode, setMode] = useState<"simple" | "deep" | "slides_only">("deep");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [estimatedTotalTime, setEstimatedTotalTime] = useState<number | null>(
    null,
  );
  const [timeElapsed, setTimeElapsed] = useState<number>(0);
  const [jobId, setJobId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Timer for time elapsed
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      interval = setInterval(() => {
        setTimeElapsed((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const parseTimestampToSeconds = (ts: string) => {
    const parts = ts.split(":").map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  };

  const renderWithTimestamps = ({ node, children, ...props }: any) => {
    // Determine which HTML tag to render
    const Tag = node?.tagName || "p";

    const jumpToTime = (timeStr: string) => {
      if (videoRef.current) {
        const sec = parseTimestampToSeconds(timeStr);
        videoRef.current.currentTime = sec;
        videoRef.current
          .play()
          .catch((e) => console.warn("Autoplay prevented:", e));
        videoRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    };

    if (typeof children === "string") {
      const match = children.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]/);
      if (match) {
        const timeStr = match[1];
        const remainingText = children.substring(match[0].length);

        return (
          <Tag {...props}>
            <button
              onClick={() => jumpToTime(timeStr)}
              className="inline-flex items-center px-2 py-0.5 rounded text-sm font-bold bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors mr-2 align-baseline cursor-pointer group"
              title="Jump to video segment"
            >
              <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              {timeStr}
            </button>
            {remainingText}
          </Tag>
        );
      }
    }

    if (Array.isArray(children)) {
      const firstChild = children[0];
      if (typeof firstChild === "string") {
        const match = firstChild.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?)\]/);
        if (match) {
          const timeStr = match[1];
          const remainingText = firstChild.substring(match[0].length);
          const restChildren = children.slice(1);

          return (
            <Tag {...props}>
              <button
                onClick={() => jumpToTime(timeStr)}
                className="inline-flex items-center px-2 py-0.5 rounded text-sm font-bold bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors mr-2 align-baseline cursor-pointer group"
                title="Jump to video segment"
              >
                <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                {timeStr}
              </button>
              {remainingText}
              {restChildren}
            </Tag>
          );
        }
      }
    }
    return <Tag {...props}>{children}</Tag>;
  };

  const extractLocalVideoMetadata = (file: File) => {
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      setVideoMetadata({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        size: file.size,
      });
    };
    video.src = url;
  };

  const clearFile = () => {
    setVideoFile(null);
    setDriveFile(null);
    setVideoMetadata(null);
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      clearFile();
      const file = e.target.files[0];
      setVideoFile(file);
      extractLocalVideoMetadata(file);
      setError(null);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith("video/")) {
        clearFile();
        setVideoFile(file);
        extractLocalVideoMetadata(file);
        setError(null);
      } else {
        setError("Please upload a valid video file.");
      }
    }
  };

  const handleDriveFileSelected = (file: any, accessToken: string) => {
    clearFile();
    setDriveFile({ ...file, token: accessToken });
    setVideoMetadata({
      duration: file.duration,
      width: file.width,
      height: file.height,
      size: file.size,
    });
    // For Drive files, we'll try to use the drive preview or media link for playback
    const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&access_token=${accessToken}`;
    setVideoUrl(url);
    setError(null);
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transcription.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyMarkdown = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      alert("Markdown copied to clipboard!");
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  const handleEmailSelf = () => {
    if (!result) return;
    const subject = encodeURIComponent("MediNotes: Clinical Transcription");
    const body = encodeURIComponent(result);
    // If the body is too large, it might fail to open the mail client.
    // We can truncate it or just try.
    const mailto = `mailto:?subject=${subject}&body=${body}`;
    window.location.href = mailto;
  };

  const [statusText, setStatusText] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pptxUrl, setPptxUrl] = useState<string | null>(null);

  const pollJobStatus = async (jobId: string) => {
    try {
      const response = await fetch(`/api/status/${jobId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch job status");
      }

      
      let data;
      try {
        data = await safeJson(response, "status");
      } catch (e: any) {
        if (e.message && e.message.includes("HTML returned")) {
          console.warn("Got HTML instead of JSON, server might be restarting. Retrying in 5 seconds...");
          setTimeout(() => pollJobStatus(jobId), 5000);
          return;
        }
        throw e;
      }
  

      if (data.status === "error") {
        setError(
          data.error || "An error occurred during asynchronous analysis.",
        );
        setLoading(false);
        setStatusText(null);
        setProgress(null);
        setPdfUrl(null);
        setPptxUrl(null);
      } else if (data.status === "complete") {
        setResult(data.result);
        if (data.pdfUrl) setPdfUrl(data.pdfUrl);
        if (data.pptxUrl) setPptxUrl(data.pptxUrl);
        setLoading(false);
        setStatusText(null);
        setProgress(null);
      } else {
        const statuses: Record<string, { text: string; progress: number }> = {
          pending: { text: "Initializing analysis...", progress: 60 },
          uploading_to_gemini: {
            text: "Uploading file to Gemini API...",
            progress: 70,
          },
          processing_video: {
            text: "Gemini API is processing the video (this may take a few minutes)...",
            progress: 80,
          },
          generating_analysis: {
            text: "Generating transcript...",
            progress: 90,
          },
          generating_pdf: { text: "Generating PDF...", progress: 95 },
          generating_pptx: { text: "Generating PPTX...", progress: 95 },
        };

        const statusInfo = statuses[data.status] || {
          text: "Processing...",
          progress: 95,
        };
        setStatusText(statusInfo.text);
        setProgress(statusInfo.progress);

        setTimeout(() => pollJobStatus(jobId), 3000);
      }
    } catch (err: any) {
      setError(err.message || "Error communicating with analysis server");
      setLoading(false);
      setStatusText(null);
      setProgress(null);
    }
  };

  const handleSubmit = async () => {
    if (!videoFile && !driveFile && !youtubeUrl) {
      setError(
        "Please select a video file, choose one from Google Drive, or provide a YouTube URL.",
      );
      return;
    }

    setLoading(true);
    setResult(null);
    setError(null);
    setPdfUrl(null);
    setStatusText("Init upload...");
    setProgress(0);

    try {
      let jobId = null;

      if (youtubeUrl) {
        setStatusText("Requesting YouTube processing...");
        setProgress(10);
        const ytRes = await fetch("/api/upload/youtube", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ youtubeUrl, mode }),
        });

        if (!ytRes.ok) throw new Error("Failed to start YouTube processing");
        const ytData = await safeJson(ytRes, "youtube");
        jobId = ytData.jobId;
        setProgress(50);
      } else if (driveFile) {
        setStatusText("Requesting Drive upload...");
        setProgress(10);
        const driveRes = await fetch("/api/upload/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileId: driveFile.id,
            accessToken: driveFile.token,
            mode,
            originalname: driveFile.name,
            mimetype: driveFile.mimeType,
          }),
        });

        if (!driveRes.ok) throw new Error("Failed to start Drive upload");
        const driveData = await safeJson(driveRes, "drive");
        jobId = driveData.jobId;
        setProgress(50);
      } else if (videoFile) {
        const initRes = await fetch("/api/upload/start", { method: "POST" });
        if (!initRes.ok) throw new Error("Failed to init upload");
        const { uploadId } = await safeJson(initRes, "init");

        const chunkSize = 5 * 1024 * 1024; // 5MB chunks
        const totalChunks = Math.ceil(videoFile.size / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
          setStatusText(`Uploading chunk ${i + 1} of ${totalChunks}...`);
          setProgress(Math.round(((i + 1) / totalChunks) * 50)); // 0-50% for chunk upload
          const chunk = videoFile.slice(i * chunkSize, (i + 1) * chunkSize);
          const formData = new FormData();
          formData.append("chunk", chunk, videoFile.name);
          formData.append("uploadId", uploadId);
          formData.append("chunkIndex", i.toString());
          formData.append("totalChunks", totalChunks.toString());
          formData.append("mode", mode);
          formData.append("originalname", videoFile.name);
          formData.append("mimetype", videoFile.type);

          const chunkRes = await fetch("/api/upload/chunk", {
            method: "POST",
            body: formData,
          });

          if (!chunkRes.ok) {
            const errText = await chunkRes.text();
            throw new Error(
              `Upload failed at chunk ${i + 1}. Server returned: ${chunkRes.status}`,
            );
          }

          const chunkData = await safeJson(chunkRes, "chunk");
          if (chunkData.complete) {
            jobId = chunkData.jobId;
          }
        }
      }

      if (jobId) {
        pollJobStatus(jobId);
      } else {
        throw new Error("Analysis started but no job ID returned.");
      }
    } catch (err: any) {
      setError(
        err.message || "An error occurred during asynchronous analysis.",
      );
      setLoading(false);
      setStatusText(null);
      setProgress(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 py-10 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">
            MediNotes
          </h1>
          <p className="text-slate-500 text-lg">
            Upload medical class videos and get comprehensive clinical
            transcriptions.
          </p>
        </div>

        {/* Upload Section */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center justify-center text-center hover:bg-slate-50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              accept="video/*"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />
            {videoFile ? (
              <div className="flex flex-col items-center space-y-3">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-full">
                  <FileVideo className="w-8 h-8" />
                </div>
                <div className="text-sm font-medium">
                  {videoFile.name} (
                  {(videoFile.size / (1024 * 1024)).toFixed(2)} MB)
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setVideoFile(null);
                  }}
                  className="text-xs text-red-500 hover:text-red-700 font-medium"
                >
                  Remove File
                </button>
              </div>
            ) : driveFile ? (
              <div className="flex flex-col items-center space-y-3">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-full">
                  <FileVideo className="w-8 h-8" />
                </div>
                <div className="text-sm font-medium">
                  {driveFile.name} (from Google Drive)
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDriveFile(null);
                  }}
                  className="text-xs text-red-500 hover:text-red-700 font-medium"
                >
                  Remove File
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center space-y-3">
                <div className="p-3 bg-slate-100 text-slate-400 rounded-full">
                  <UploadCloud className="w-8 h-8" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    MP4, WebM, MOV (Max size depends on Gemini API)
                  </p>
                </div>
              </div>
            )}
          </div>

          {!videoFile && !driveFile && !youtubeUrl && (
            <div className="mt-4 flex flex-col items-center justify-center space-y-4">
              <div className="text-sm text-slate-400 divider w-full text-center relative">
                <span className="bg-white px-2 relative z-10">OR</span>
                <div className="absolute top-1/2 left-0 w-full h-px bg-slate-200 -z-10"></div>
              </div>

              <div className="w-full flex flex-col space-y-2">
                <label className="text-sm font-medium text-slate-700 text-left">
                  YouTube URL
                </label>
                <div className="flex space-x-2">
                  <input
                    type="url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-shadow"
                  />
                </div>
              </div>

              <div className="text-sm text-slate-400 divider w-full text-center relative">
                <span className="bg-white px-2 relative z-10">OR</span>
                <div className="absolute top-1/2 left-0 w-full h-px bg-slate-200 -z-10"></div>
              </div>
              <GoogleDriveUpload onFileSelected={handleDriveFileSelected} />
            </div>
          )}

          {youtubeUrl && !videoFile && !driveFile && (
            <div className="mt-4 flex flex-col items-center justify-center p-4 border rounded-xl bg-red-50 border-red-200">
              <div className="text-sm font-medium text-red-700">
                YouTube Video Selected
              </div>
              <div className="text-xs text-red-600 mt-1 truncate max-w-xs">
                {youtubeUrl}
              </div>
              <button
                onClick={() => setYoutubeUrl("")}
                className="mt-3 text-xs text-red-500 hover:text-red-700 font-medium"
              >
                Clear URL
              </button>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-lg flex items-center space-x-2 text-sm">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}

          {videoMetadata && (videoFile || driveFile) && (
            <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center">
                <CheckCircle2 className="w-4 h-4 text-green-500 mr-2" />
                File Validation Summary
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="flex flex-col">
                  <span className="text-xs text-slate-500 mb-1 flex items-center">
                    <Video className="w-3 h-3 mr-1" /> Duration
                  </span>
                  <span className="text-sm font-medium">
                    {videoMetadata.duration
                      ? Math.floor(videoMetadata.duration / 60) +
                        "m " +
                        Math.floor(videoMetadata.duration % 60) +
                        "s"
                      : "Unknown"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-slate-500 mb-1 flex items-center">
                    <Monitor className="w-3 h-3 mr-1" /> Resolution
                  </span>
                  <span className="text-sm font-medium">
                    {videoMetadata.width && videoMetadata.height
                      ? `${videoMetadata.width}x${videoMetadata.height}`
                      : "Unknown"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-slate-500 mb-1 flex items-center">
                    <File className="w-3 h-3 mr-1" /> Size
                  </span>
                  <span className="text-sm font-medium">
                    {videoMetadata.size
                      ? (videoMetadata.size / (1024 * 1024)).toFixed(2) + " MB"
                      : "Unknown"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs text-slate-500 mb-1 flex items-center">
                    <Clock className="w-3 h-3 mr-1" /> Est. Time
                  </span>
                  <span className="text-sm font-medium text-blue-600">
                    {videoMetadata.duration
                      ? Math.ceil((videoMetadata.duration * 0.4) / 60) + " min"
                      : "Unknown"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Mode Selector */}
          <div className="mt-6 flex flex-col sm:flex-row gap-4">
            <label
              className={`flex-1 relative flex cursor-pointer rounded-xl border p-4 shadow-sm focus:outline-none ${mode === "simple" ? "bg-blue-50 border-blue-200" : "bg-white border-slate-200"}`}
            >
              <input
                type="radio"
                name="mode"
                value="simple"
                checked={mode === "simple"}
                onChange={() => setMode("simple")}
                className="sr-only"
              />
              <div className="flex flex-1">
                <div className="flex flex-col">
                  <span className="block text-sm font-medium flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-blue-600 mr-2" />
                    Simple
                  </span>
                  <span className="mt-1 flex items-center text-xs text-slate-500">
                    Spoken audio only.
                  </span>
                </div>
              </div>
            </label>

            <label
              className={`flex-1 relative flex cursor-pointer rounded-xl border p-4 shadow-sm focus:outline-none ${mode === "deep" ? "bg-indigo-50 border-indigo-200" : "bg-white border-slate-200"}`}
            >
              <input
                type="radio"
                name="mode"
                value="deep"
                checked={mode === "deep"}
                onChange={() => setMode("deep")}
                className="sr-only"
              />
              <div className="flex flex-1">
                <div className="flex flex-col">
                  <span className="block text-sm font-medium flex items-center space-x-2">
                    <Activity className="w-4 h-4 text-indigo-600 mr-2" />
                    Deep Analysis
                  </span>
                  <span className="mt-1 flex items-center text-xs text-slate-500">
                    All tables & text (+ PDF).
                  </span>
                </div>
              </div>
            </label>

            <label
              className={`flex-1 relative flex cursor-pointer rounded-xl border p-4 shadow-sm focus:outline-none ${mode === "slides_only" ? "bg-amber-50 border-amber-200" : "bg-white border-slate-200"}`}
            >
              <input
                type="radio"
                name="mode"
                value="slides_only"
                checked={mode === "slides_only"}
                onChange={() => setMode("slides_only")}
                className="sr-only"
              />
              <div className="flex flex-1">
                <div className="flex flex-col">
                  <span className="block text-sm font-medium flex items-center space-x-2">
                    <Monitor className="w-4 h-4 text-amber-600 mr-2" />
                    Slides Only
                  </span>
                  <span className="mt-1 flex items-center text-xs text-slate-500">
                    Extract presentation only (+ PDF).
                  </span>
                </div>
              </div>
            </label>
          </div>

          <div className="mt-6">
            <button
              disabled={(!videoFile && !driveFile) || loading}
              onClick={handleSubmit}
              className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white ${loading || (!videoFile && !driveFile) ? "bg-slate-300 cursor-not-allowed" : "bg-slate-900 hover:bg-slate-800"}`}
            >
              {loading ? "Analyzing Video..." : "Analyze Video"}
            </button>

            {loading && progress !== null && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>{statusText || "Processing..."}</span>
                  <div className="flex space-x-3 text-right">
                    {estimatedTotalTime && (
                      <span className="text-blue-500 font-medium">
                        ~
                        {Math.floor(
                          Math.max(0, estimatedTotalTime - timeElapsed) / 60,
                        )}
                        m{" "}
                        {Math.floor(
                          Math.max(0, estimatedTotalTime - timeElapsed) % 60,
                        )}
                        s remaining
                      </span>
                    )}
                    <span>{progress}%</span>
                  </div>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                  <div
                    className="bg-slate-900 h-2.5 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Results Section */}
        {result && (
          <div className="space-y-6">
            {videoUrl && (
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200">
                <h3 className="text-sm font-semibold mb-2">Video Reference</h3>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="w-full h-auto bg-black rounded-lg max-h-[300px]"
                />
              </div>
            )}

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex flex-col sm:flex-row items-center justify-between mb-6 gap-4 border-b border-slate-100 pb-4">
                <h2 className="text-xl font-bold text-slate-900">
                  Analysis Result
                </h2>
                <div className="flex flex-wrap gap-2">
                  {pdfUrl && (
                    <button
                      onClick={() => setPdfModalOpen(true)}
                      className="flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
                      title="View PDF"
                    >
                      <FileText className="w-4 h-4 mr-2" />
                      View PDF
                    </button>
                  )}
                  <button
                    onClick={handleCopyMarkdown}
                    className="flex items-center px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy
                  </button>
                  <button
                    onClick={handleEmailSelf}
                    className="flex items-center px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Email
                  </button>
                  <button
                    onClick={handleDownload}
                    className="flex items-center px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-lg transition-colors"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </button>
                </div>
              </div>
              <div className="prose prose-slate max-w-none prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-a:text-blue-600 prose-img:rounded-xl">
                <ReactMarkdown
                  components={{
                    p: renderWithTimestamps,
                    li: renderWithTimestamps,
                    h1: renderWithTimestamps,
                    h2: renderWithTimestamps,
                    h3: renderWithTimestamps,
                    h4: renderWithTimestamps,
                  }}
                >
                  {result}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        )}

        {/* Modal for PDF Preview */}
        {pdfModalOpen && pdfUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="font-semibold text-slate-800 flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-blue-600" />
                  PDF Preview
                </h3>
                <div className="flex items-center space-x-2">
                  <a
                    href={pdfUrl}
                    download
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm inline-flex items-center"
                    title="Download Presentation PDF"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </a>
                  <button
                    onClick={() => setPdfModalOpen(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="flex-1 bg-slate-200 p-4">
                <iframe
                  src={`${pdfUrl}#toolbar=0`}
                  className="w-full h-full rounded shadow-sm border border-slate-300"
                  title="PDF Preview"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
