import { useState, useEffect } from "react";
import { Cloud, AlertCircle } from "lucide-react";
import { googleSignIn, initAuth, getAccessToken } from "./firebase";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  duration?: number;
  width?: number;
  height?: number;
}

interface GoogleDriveUploadProps {
  onFileSelected: (file: DriveFile, accessToken: string) => void;
}

export function GoogleDriveUpload({ onFileSelected }: GoogleDriveUploadProps) {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => setNeedsAuth(false),
      () => setNeedsAuth(true),
    );
    return () => unsubscribe();
  }, []);

  const handleLoginAndPick = async () => {
    setError(null);
    let token = await getAccessToken();

    if (!token) {
      setIsLoggingIn(true);
      try {
        const result = await googleSignIn();
        if (result) {
          token = result.accessToken;
          setNeedsAuth(false);
        }
      } catch (err: any) {
        if (
          err?.code === "auth/popup-closed-by-user" ||
          err?.code === "auth/cancelled-popup-request"
        ) {
          setError(null); // User intentionally closed it
        } else {
          console.error("Login failed:", err);
          setError("Sign in with Google failed.");
        }
        setIsLoggingIn(false);
        return;
      }
      setIsLoggingIn(false);
    }

    if (token) {
      openPicker(token);
    }
  };

  const openPicker = (token: string) => {
    if (!(window as any).google || !(window as any).google.picker) {
      (window as any).gapi.load("picker", {
        callback: () => createPicker(token),
      });
    } else {
      createPicker(token);
    }
  };

  const createPicker = (token: string) => {
    const pickerOrigin =
      window.location.ancestorOrigins &&
      window.location.ancestorOrigins.length > 0
        ? window.location.ancestorOrigins[
            window.location.ancestorOrigins.length - 1
          ]
        : window.location.origin;

    const view = new (window as any).google.picker.DocsView(
      (window as any).google.picker.ViewId.DOCS,
    ).setMimeTypes("video/mp4,video/webm,video/quicktime,video/x-msvideo");

    const picker = new (window as any).google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setCallback((data: any) => pickerCallback(data, token))
      .setOrigin(pickerOrigin)
      .build();

    picker.setVisible(true);
  };

  const pickerCallback = async (data: any, token: string) => {
    if (data.action === (window as any).google.picker.Action.PICKED) {
      const file = data.docs[0];
      try {
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}?fields=size,videoMediaMetadata`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        const metadata = await res.json();
        onFileSelected(
          {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            size: metadata.size ? parseInt(metadata.size) : undefined,
            duration: metadata.videoMediaMetadata?.durationMillis
              ? parseInt(metadata.videoMediaMetadata.durationMillis) / 1000
              : undefined,
            width: metadata.videoMediaMetadata?.width,
            height: metadata.videoMediaMetadata?.height,
          },
          token,
        );
      } catch (err) {
        console.error("Failed to fetch extra metadata from Drive:", err);
        // Fallback to basic pick
        onFileSelected(
          {
            id: file.id,
            name: file.name,
            mimeType: file.mimeType,
            size: file.sizeBytes || undefined,
          },
          token,
        );
      }
    }
  };

  return (
    <div className="flex flex-col items-center">
      <button
        onClick={handleLoginAndPick}
        disabled={isLoggingIn}
        className="flex items-center space-x-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50"
      >
        <Cloud className="w-5 h-5" />
        <span className="font-medium">
          {isLoggingIn ? "Connecting..." : "Select from Google Drive"}
        </span>
      </button>
      {error && (
        <div className="mt-2 flex items-center text-red-500 text-xs">
          <AlertCircle className="w-4 h-4 mr-1" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
