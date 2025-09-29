import { createSignal, Show, For } from "solid-js";
import { Modal } from "../ui/Modal";

import { MusicIcon, CheckIcon, XIcon, AlertTriangleIcon } from "../icons";
import { apiClient } from "../../../../lib/api-client";
import { useGlobalEvents } from "../../hooks/useGlobalEvents";
import type { Song } from "../../../../lib/music/schemas/song";

interface AddMusicModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const handleModalClose = (props: AddMusicModalProps, events: any) => {
  // Emit data reload event to refresh the songs list
  events.emit("data:reload", { type: "songs" });
  props.onClose();
};

interface UploadItem {
  id: string;
  file: File;
  status:
    | "pending"
    | "uploading"
    | "processing"
    | "completed"
    | "error"
    | "cancelled"
    | "duplicate";
  progress: number;
  processingStep?: string;
  jobId?: string;
  songId?: string;
  error?: string;
  errorType?: string;
  canRetry: boolean;
  canCancel: boolean;
  existingSongId?: string;
  albumArtFor?: string;
}

interface DownloadItem {
  id: string;
  url: string;
  status: "queued" | "downloading" | "completed" | "error";
  progress: number;
  error?: string;
}

interface DownloadJobStatusResponse {
  job_id: string;
  url: string;
  status: string;
  download_path?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

interface DownloadUrlsResponse {
  message: string;
  download_jobs: Array<{
    job_id: string;
    url: string;
    status: string;
  }>;
}

export function AddMusicModal(props: AddMusicModalProps) {
  const events = useGlobalEvents();
  const [uploads, setUploads] = createSignal<UploadItem[]>([]);
  const [downloads, setDownloads] = createSignal<DownloadItem[]>([]);
  const [isDragOver, setIsDragOver] = createSignal(false);
  const [uploadMode, setUploadMode] = createSignal<"files" | "urls">("files");
  const [urlsText, setUrlsText] = createSignal("");
  const [isSubmittingUrls, setIsSubmittingUrls] = createSignal(false);
  const [urlDownloadError, setUrlDownloadError] = createSignal<string | null>(
    null
  );

  let fileInputRef: HTMLInputElement | undefined;

  // Audio file extensions
  const audioExtensions = [".mp3", ".flac", ".wav", ".m4a", ".ogg", ".aac"];
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

  const isAudioFile = (file: File): boolean => {
    return audioExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));
  };

  const isImageFile = (file: File): boolean => {
    return file.type.startsWith("image/");
  };

  const validateFile = (file: File): { valid: boolean; error?: string } => {
    const maxSize = 1024 * 1024 * 1024; // 1GB

    if (file.size > maxSize) {
      return { valid: false, error: "file exceeds 1gb limit" };
    }

    const isAudio = isAudioFile(file);
    const isImage = isImageFile(file);

    if (!isAudio && !isImage) {
      return { valid: false, error: "unsupported file type" };
    }

    return { valid: true };
  };

  const calculateSHA256 = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  const checkForDuplicate = async (sha256: string): Promise<any> => {
    const response = await fetch(
      `${apiClient.getBaseUrl()}/api/media_blob/check_duplicate/${sha256}`,
      {
        credentials: "include",
      }
    );

    if (!response.ok) {
      throw new Error("Failed to check for duplicates");
    }

    return response.json();
  };

  const uploadFile = async (upload: UploadItem): Promise<void> => {
    try {
      // Calculate SHA256 hash
      const sha256 = await calculateSHA256(upload.file);

      // Check for duplicates
      try {
        const duplicateCheck = await checkForDuplicate(sha256);
        if (duplicateCheck.exists) {
          setUploads((prev) =>
            prev.map((u) =>
              u.id === upload.id
                ? {
                    ...u,
                    status: "duplicate",
                    existingSongId: duplicateCheck.existing_song_id,
                  }
                : u
            )
          );
          return;
        }
      } catch (err) {
        console.warn("Duplicate check failed, proceeding with upload:", err);
      }

      // Prepare upload request
      const uploadRequest = {
        filename: upload.file.name,
        mime_type: upload.file.type,
        sha256,
        size: upload.file.size,
        metadata: {
          original_filename: upload.file.name,
          process_music: isAudioFile(upload.file),
          ...(upload.albumArtFor && { album_art_for: upload.albumArtFor }),
        },
      };

      // Create form data
      const formData = new FormData();
      formData.append("file", upload.file);
      formData.append("metadata", JSON.stringify(uploadRequest));

      // Update status to uploading
      setUploads((prev) =>
        prev.map((u) =>
          u.id === upload.id ? { ...u, status: "uploading", progress: 0 } : u
        )
      );

      // Upload file
      const response = await fetch(`${apiClient.getBaseUrl()}/api/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const result = await response.json();

      // Update with job ID if this is an audio file
      if (result.job_id) {
        setUploads((prev) =>
          prev.map((u) =>
            u.id === upload.id
              ? {
                  ...u,
                  status: "processing",
                  progress: 10,
                  jobId: result.job_id,
                }
              : u
          )
        );

        // Start polling job status
        pollJobStatus(upload.id, result.job_id);
      } else {
        // Non-audio file, mark as completed
        setUploads((prev) =>
          prev.map((u) =>
            u.id === upload.id
              ? { ...u, status: "completed", progress: 100 }
              : u
          )
        );
      }
    } catch (error) {
      console.error("Upload failed:", error);
      setUploads((prev) =>
        prev.map((u) =>
          u.id === upload.id
            ? {
                ...u,
                status: "error",
                error: error instanceof Error ? error.message : "Upload failed",
                canRetry: true,
              }
            : u
        )
      );
    }
  };

  const pollJobStatus = async (uploadId: string, jobId: string) => {
    try {
      const response = await fetch(
        `${apiClient.getBaseUrl()}/api/music_job_status/${jobId}`,
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to get job status");
      }

      const status = await response.json();

      setUploads((prev) =>
        prev.map((u) => {
          if (u.id !== uploadId) return u;

          const processingStep = status.processing_step;
          let progress = u.progress;

          // Update progress based on processing step
          switch (processingStep) {
            case "metadata":
              progress = 30;
              break;
            case "thumbnail":
              progress = 50;
              break;
            case "waveform":
              progress = 70;
              break;
            case "song_creation":
              progress = 90;
              break;
          }

          if (status.status === "completed") {
            return {
              ...u,
              status: "completed",
              progress: 100,
              songId: status.song_id,
              canCancel: false,
            };
          } else if (status.status === "failed") {
            return {
              ...u,
              status: "error",
              error: status.error_message,
              errorType: status.error_type,
              canRetry: status.can_retry,
              canCancel: false,
            };
          } else {
            return {
              ...u,
              progress,
              processingStep,
              canCancel:
                status.status === "pending" || status.status === "in_progress",
            };
          }
        })
      );

      // Continue polling if still processing
      if (status.status === "pending" || status.status === "in_progress") {
        setTimeout(() => pollJobStatus(uploadId, jobId), 2000);
      }
    } catch (error) {
      console.error("Failed to poll job status:", error);
      setUploads((prev) =>
        prev.map((u) =>
          u.id === uploadId
            ? {
                ...u,
                status: "error",
                error: "Failed to track processing status",
                canRetry: true,
              }
            : u
        )
      );
    }
  };

  const handleFiles = (files: FileList) => {
    const newUploads: UploadItem[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file) {
        const validation = validateFile(file);

        if (validation.valid) {
          newUploads.push({
            id: crypto.randomUUID(),
            file,
            status: "pending",
            progress: 0,
            canRetry: false,
            canCancel: true,
          });
        } else {
          newUploads.push({
            id: crypto.randomUUID(),
            file,
            status: "error",
            progress: 0,
            error: validation.error,
            canRetry: false,
            canCancel: false,
          });
        }
      }
    }

    setUploads((prev) => [...prev, ...newUploads]);

    // Start uploading valid files
    newUploads
      .filter((u) => u.status === "pending")
      .forEach((upload) => {
        uploadFile(upload);
      });
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (e.dataTransfer?.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileSelect = () => {
    fileInputRef?.click();
  };

  const handleFileInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (input.files) {
      handleFiles(input.files);
    }
  };

  const cancelUpload = async (id: string) => {
    const upload = uploads().find((u) => u.id === id);
    if (!upload || !upload.jobId) return;

    try {
      await fetch(
        `${apiClient.getBaseUrl()}/api/music_job_cancel/${upload.jobId}`,
        {
          method: "POST",
          credentials: "include",
        }
      );

      setUploads((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, status: "cancelled", canCancel: false } : u
        )
      );
    } catch (error) {
      console.error("Failed to cancel upload:", error);
    }
  };

  const retryUpload = (id: string) => {
    const upload = uploads().find((u) => u.id === id);
    if (upload) {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === id ? { ...u, status: "pending", error: undefined } : u
        )
      );
      uploadFile(upload);
    }
  };

  const removeUpload = (id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  };

  const setAlbumArtFor = (id: string, albumName: string) => {
    setUploads((prev) =>
      prev.map((u) => (u.id === id ? { ...u, albumArtFor: albumName } : u))
    );
  };

  const viewExistingSong = (songId?: string) => {
    if (songId) {
      // Navigate to existing song or open song modal
      console.log("View existing song:", songId);
    }
  };

  const replaceFile = (id: string) => {
    const upload = uploads().find((u) => u.id === id);
    if (upload) {
      setUploads((prev) =>
        prev.map((u) => (u.id === id ? { ...u, status: "pending" } : u))
      );
      uploadFile(upload);
    }
  };

  const skipFile = (id: string) => {
    removeUpload(id);
  };

  const openSongEditModal = async (songId?: string) => {
    if (songId) {
      try {
        // Fetch the song data
        const song = await apiClient.getSong(songId);

        // Close this modal and open the song info modal with the song data
        handleModalClose(props, events);

        // Open song edit modal
        events.emit("modal:open", {
          modal: "songInfoModal",
          data: { songs: [song] },
        });
      } catch (error) {
        console.error("Failed to fetch song for editing:", error);
      }
    }
  };

  const openBulkEditModal = async () => {
    const completedUploads = uploads().filter(
      (upload) => upload.status === "completed" && upload.songId
    );

    if (completedUploads.length === 0) return;

    try {
      // Fetch all song data
      const songs: Song[] = [];
      for (const upload of completedUploads) {
        if (upload.songId) {
          const song = await apiClient.getSong(upload.songId);
          songs.push(song);
        }
      }

      // Close this modal and open the song info modal with all songs
      handleModalClose(props, events);

      // Open song edit modal in bulk mode
      events.emit("modal:open", {
        modal: "songInfoModal",
        data: { songs },
      });
    } catch (error) {
      console.error("Failed to fetch songs for bulk editing:", error);
    }
  };

  const navigateToSong = (songId?: string) => {
    if (songId) {
      // Navigate to song
      console.log("Navigate to song:", songId);
      handleModalClose(props, events);
    }
  };

  // Compute completed uploads
  const completedUploads = () =>
    uploads().filter(
      (upload) => upload.status === "completed" && upload.songId
    );

  // Compute completed downloads
  const completedDownloads = () =>
    downloads().filter((download) => download.status === "completed");

  // Check if any uploads have started
  const hasStartedUploads = () =>
    uploads().length > 0 || downloads().length > 0;

  // Submit URLs for download
  const submitUrls = async () => {
    const urlsToDownload = urlsText()
      .split("\n")
      .map((url) => url.trim())
      .filter((url) => url.length > 0);

    if (urlsToDownload.length === 0) {
      return;
    }

    setIsSubmittingUrls(true);
    setUrlDownloadError(null); // Clear any previous errors

    try {
      const response = await apiClient.makeRequest(
        "POST",
        "/api/media/download-urls",
        {
          data: { urls: urlsToDownload },
          headers: { "Content-Type": "application/json" },
        }
      );

      console.log("URL download jobs created:", response);

      // Add download jobs to tracking
      const downloadItems: DownloadItem[] = (
        response as DownloadUrlsResponse
      ).download_jobs.map((job) => ({
        id: job.job_id,
        url: job.url,
        status: "queued" as const,
        progress: 0,
      }));
      setDownloads(downloadItems);

      // Start polling for download status
      downloadItems.forEach((item) => {
        pollDownloadStatus(item.id);
      });

      // Clear the textarea and stay in URL mode to show progress
      setUrlsText("");
    } catch (error) {
      console.error("Failed to submit URLs for download:", error);
      setUrlDownloadError("onoz! server gave an error! ...try again?");
    } finally {
      setIsSubmittingUrls(false);
    }
  };

  // Poll download job status
  const pollDownloadStatus = async (jobId: string) => {
    try {
      const response = await fetch(
        `${apiClient.getBaseUrl()}/api/media/download-job-status/${jobId}`,
        {
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to get download job status");
      }

      const status = (await response.json()) as DownloadJobStatusResponse;

      setDownloads((prev) =>
        prev.map((download) => {
          if (download.id !== jobId) return download;

          const newStatus =
            status.status === "in_progress"
              ? ("downloading" as const)
              : status.status === "completed"
                ? ("completed" as const)
                : status.status === "failed"
                  ? ("error" as const)
                  : ("queued" as const);

          return {
            ...download,
            status: newStatus,
            progress:
              status.status === "completed"
                ? 100
                : status.status === "in_progress"
                  ? 50
                  : 0,
            error: status.error_message,
          };
        })
      );

      // Continue polling if still processing
      if (status.status === "queued" || status.status === "in_progress") {
        setTimeout(() => pollDownloadStatus(jobId), 2000);
      }
    } catch (error) {
      console.error("Failed to poll download status:", error);
      setDownloads((prev) =>
        prev.map((download) =>
          download.id === jobId
            ? {
                ...download,
                status: "error" as const,
                error: "Failed to track download status",
              }
            : download
        )
      );
    }
  };

  // Check if there are any uploads still processing
  const hasProcessingUploads = () =>
    uploads().some(
      (upload) =>
        upload.status === "pending" ||
        upload.status === "uploading" ||
        upload.status === "processing"
    );

  // Check if user has interacted with completed uploads (e.g., edited metadata)
  const hasUntouchedCompletedUploads = () => {
    const completed = completedUploads();
    // Consider uploads "untouched" if they exist and user hasn't used edit functionality
    return completed.length > 0;
  };

  // Reset upload state for new uploads
  const resetUploads = () => {
    setUploads([]);
    setDownloads([]);
  };

  // Handle "add more music" with confirmation if needed
  const handleAddMoreMusic = () => {
    const needsConfirmation =
      hasProcessingUploads() || hasUntouchedCompletedUploads();

    if (needsConfirmation) {
      const processingCount = uploads().filter(
        (u) =>
          u.status === "pending" ||
          u.status === "uploading" ||
          u.status === "processing"
      ).length;
      const downloadingCount = downloads().filter(
        (d) => d.status === "queued" || d.status === "downloading"
      ).length;
      const completedCount =
        completedUploads().length + completedDownloads().length;

      let message = "start a new upload session?\n\n";

      if (processingCount > 0) {
        message += `⏳ ${processingCount} file(s) still processing - they will be cancelled\n`;
      }
      if (downloadingCount > 0) {
        message += `⬇️ ${downloadingCount} download(s) still in progress - they will be cancelled\n`;
      }
      if (completedCount > 0) {
        message += `✅ ${completedCount} completed item(s) will be cleared\n`;
      }
      message += "\nthis action cannot be undone.";

      if (confirm(message)) {
        resetUploads();
      }
    } else {
      resetUploads();
    }
  };

  const StatusBadge = (props: { status: UploadItem["status"] }) => {
    const getStatusColor = () => {
      switch (props.status) {
        case "completed":
          return "text-green-400";
        case "processing":
        case "uploading":
          return "text-blue-400";
        case "error":
        case "cancelled":
          return "text-red-400";
        case "duplicate":
          return "text-yellow-400";
        default:
          return "text-gray-400";
      }
    };

    const getStatusText = () => {
      switch (props.status) {
        case "pending":
          return "pending";
        case "uploading":
          return "uploading";
        case "processing":
          return "processing";
        case "completed":
          return "completed";
        case "error":
          return "error";
        case "cancelled":
          return "cancelled";
        case "duplicate":
          return "duplicate";
        default:
          return "unknown";
      }
    };

    const getStatusIcon = () => {
      switch (props.status) {
        case "completed":
          return <CheckIcon size={12} />;
        case "error":
        case "cancelled":
          return <XIcon size={12} />;
        case "duplicate":
          return <AlertTriangleIcon size={12} />;
        default:
          return null;
      }
    };

    return (
      <span
        class={`text-xs px-2 py-1 border border-gray-600 flex items-center gap-1 ${getStatusColor()}`}
      >
        {getStatusIcon()}
        {getStatusText()}
      </span>
    );
  };

  const ProgressBar = (props: { progress: number }) => (
    <div class="w-full bg-gray-700 h-2">
      <div
        class="bg-magenta-600 h-2 transition-all duration-300"
        style={{ width: `${props.progress}%` }}
      />
    </div>
  );

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={() => handleModalClose(props, events)}
      title="add music"
      size="lg"
    >
      <div class="space-y-6">
        {/* Upload Mode Toggle */}
        <Show when={!hasStartedUploads()}>
          <div class="flex items-center justify-center space-x-4 pb-4 border-b border-gray-700">
            <button
              class={`px-4 py-2 text-sm transition-colors ${
                uploadMode() === "files"
                  ? "bg-magenta-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              onClick={() => setUploadMode("files")}
            >
              Upload Files
            </button>
            <button
              class={`px-4 py-2 text-sm transition-colors ${
                uploadMode() === "urls"
                  ? "bg-magenta-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
              onClick={() => setUploadMode("urls")}
            >
              Download URLs
            </button>
          </div>
        </Show>

        {/* File Selection Area */}
        <Show when={!hasStartedUploads() && uploadMode() === "files"}>
          <div
            class={`border-2 border-dashed p-8 text-center transition-colors ${
              isDragOver()
                ? "border-magenta-400 bg-magenta-600/10"
                : "border-gray-600"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <MusicIcon size={48} className="mx-auto mb-4 text-gray-400" />
            <h3 class="text-lg font-semibold mb-2">add music files</h3>
            <p class="text-gray-400 mb-4">
              drag audio files here or click to select
            </p>
            <p class="text-sm text-gray-500 mb-2">
              supports mp3, flac, wav, m4a, ogg • max 1gb per file
            </p>
            <p class="text-sm text-gray-500 mb-4">
              also accepts jpg/png for album artwork
            </p>
            <button
              onClick={handleFileSelect}
              class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 transition-colors"
            >
              select files
            </button>
            <input
              ref={fileInputRef!}
              type="file"
              multiple
              accept={[...audioExtensions, ...imageExtensions].join(",")}
              onChange={handleFileInput}
              class="hidden"
            />
          </div>
        </Show>

        {/* URL Download Area */}
        <Show when={!hasStartedUploads() && uploadMode() === "urls"}>
          <div class="space-y-4">
            <div class="text-center">
              <h3 class="text-lg font-semibold mb-2">download from urls</h3>
              <p class="text-gray-400 mb-4">
                enter youtube, soundcloud, or other supported urls (one per
                line)
              </p>
            </div>

            <textarea
              class="w-full h-32 p-3 bg-gray-800 border border-gray-600 text-white placeholder-gray-400 resize-none focus:outline-none focus:border-magenta-500"
              placeholder="https://www.youtube.com/watch?v=..."
              value={urlsText()}
              onInput={(e) => setUrlsText(e.currentTarget.value)}
            />

            <div class="flex flex-col items-center">
              <button
                class="px-6 py-2 bg-magenta-600 hover:bg-magenta-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={submitUrls}
                disabled={isSubmittingUrls() || urlsText().trim().length === 0}
              >
                {isSubmittingUrls() ? "submitting..." : "download"}
              </button>

              <Show when={urlDownloadError()}>
                <div class="mt-2 text-sm text-red-400 text-center">
                  {urlDownloadError()}
                </div>
              </Show>
            </div>
          </div>
        </Show>

        {/* Upload Progress List */}
        <Show when={uploads().length > 0 || downloads().length > 0}>
          <div class="space-y-4 max-h-96 overflow-y-auto">
            {/* File Uploads */}
            <For each={uploads()}>
              {(upload) => (
                <div class="p-4 border border-gray-700 bg-gray-800/30">
                  <div class="flex items-center justify-between mb-2">
                    <span class="font-medium truncate flex-1 mr-4">
                      {upload.file.name}
                    </span>
                    <StatusBadge status={upload.status} />
                  </div>

                  {/* Progress for uploading/processing */}
                  <Show
                    when={
                      upload.status === "uploading" ||
                      upload.status === "processing"
                    }
                  >
                    <div class="mb-2">
                      <ProgressBar progress={upload.progress} />
                      <Show when={upload.processingStep}>
                        <div class="text-xs text-gray-400 mt-1">
                          {upload.processingStep === "metadata" &&
                            "extracting metadata..."}
                          {upload.processingStep === "thumbnail" &&
                            "generating thumbnail..."}
                          {upload.processingStep === "waveform" &&
                            "creating waveform..."}
                          {upload.processingStep === "song_creation" &&
                            "creating song record..."}
                        </div>
                      </Show>
                    </div>
                    <Show when={upload.canCancel}>
                      <button
                        class="px-3 py-1 text-xs border border-gray-600 hover:border-gray-500 transition-colors"
                        onClick={() => cancelUpload(upload.id)}
                      >
                        cancel
                      </button>
                    </Show>
                  </Show>

                  {/* Duplicate file handling */}
                  <Show when={upload.status === "duplicate"}>
                    <div class="mt-2 p-3 bg-yellow-900/20 border border-yellow-600/30">
                      <div class="text-sm text-yellow-400 mb-2">
                        this file already exists in your library
                      </div>
                      <div class="flex gap-2">
                        <button
                          class="px-3 py-1 text-xs bg-yellow-600 hover:bg-yellow-500 text-black transition-colors"
                          onClick={() =>
                            viewExistingSong(upload.existingSongId)
                          }
                        >
                          view existing
                        </button>
                        <button
                          class="px-3 py-1 text-xs border border-gray-600 hover:border-gray-500 transition-colors"
                          onClick={() => replaceFile(upload.id)}
                        >
                          replace
                        </button>
                        <button
                          class="px-3 py-1 text-xs border border-gray-600 hover:border-gray-500 transition-colors"
                          onClick={() => skipFile(upload.id)}
                        >
                          skip
                        </button>
                      </div>
                    </div>
                  </Show>

                  {/* Album art association */}
                  <Show when={isImageFile(upload.file)}>
                    <div class="mt-2 p-3 bg-magenta-900/20 border border-magenta-600/30">
                      <div class="text-sm text-magenta-400 mb-2">
                        associate with album (optional)
                      </div>
                      <input
                        type="text"
                        placeholder="album name"
                        value={upload.albumArtFor || ""}
                        onInput={(e) =>
                          setAlbumArtFor(upload.id, e.currentTarget.value)
                        }
                        class="w-full px-3 py-1 text-sm bg-black border border-gray-600 text-white"
                      />
                    </div>
                  </Show>

                  {/* Success state */}
                  <Show when={upload.status === "completed" && upload.songId}>
                    <div class="mt-2 flex gap-2">
                      <Show when={completedUploads().length === 1}>
                        <button
                          class="px-4 py-1 text-sm bg-magenta-600 hover:bg-magenta-500 transition-colors"
                          onClick={() => openSongEditModal(upload.songId)}
                        >
                          edit metadata
                        </button>
                      </Show>
                      <button
                        class="px-4 py-1 text-sm border border-gray-600 hover:border-gray-500 transition-colors"
                        onClick={() => navigateToSong(upload.songId)}
                      >
                        view song
                      </button>
                    </div>
                  </Show>

                  {/* Error handling */}
                  <Show when={upload.status === "error"}>
                    <div class="mt-2 p-3 bg-red-900/20 border border-red-600/30">
                      <div class="text-sm text-red-400 mb-2">
                        {upload.errorType === "unsupported_format" &&
                          "unsupported audio format"}
                        {upload.errorType === "corrupted_file" &&
                          "file appears to be corrupted"}
                        {upload.errorType === "metadata_extraction_failed" &&
                          "could not extract metadata"}
                        {upload.errorType === "size_limit" &&
                          "file exceeds size limit"}
                        {!upload.errorType && (upload.error || "upload failed")}
                      </div>
                      <div class="flex gap-2">
                        <Show when={upload.canRetry}>
                          <button
                            class="px-3 py-1 text-xs border border-gray-600 hover:border-gray-500 transition-colors"
                            onClick={() => retryUpload(upload.id)}
                          >
                            retry
                          </button>
                        </Show>
                        <button
                          class="px-3 py-1 text-xs border border-gray-600 hover:border-gray-500 transition-colors"
                          onClick={() => removeUpload(upload.id)}
                        >
                          remove
                        </button>
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </For>

            {/* URL Downloads */}
            <For each={downloads()}>
              {(download) => (
                <div class="p-4 border border-gray-700 bg-gray-800/30">
                  <div class="flex items-center justify-between mb-2">
                    <span class="font-medium truncate flex-1 mr-4">
                      {download.url}
                    </span>
                    <div
                      class={`px-2 py-1 text-xs rounded ${
                        download.status === "completed"
                          ? "bg-green-600/20 text-green-400"
                          : download.status === "error"
                            ? "bg-red-600/20 text-red-400"
                            : "bg-blue-600/20 text-blue-400"
                      }`}
                    >
                      {download.status}
                    </div>
                  </div>

                  <Show when={download.status === "downloading"}>
                    <div class="w-full bg-gray-700 h-2">
                      <div
                        class="bg-magenta-600 h-2 transition-all duration-300"
                        style={{ width: `${download.progress}%` }}
                      />
                    </div>
                  </Show>

                  <Show when={download.status === "error"}>
                    <div class="mt-2 text-sm text-red-400">
                      {download.error || "Download failed"}
                    </div>
                  </Show>
                </div>
              )}
            </For>

            {/* Bulk edit button for multiple completed uploads */}
            <Show when={completedUploads().length > 1}>
              <div class="mt-4 p-4 border-t border-gray-700">
                <div class="flex items-center justify-between">
                  <div class="text-sm text-gray-400">
                    {completedUploads().length} songs uploaded successfully
                  </div>
                  <button
                    class="px-4 py-2 text-sm bg-magenta-600 hover:bg-magenta-500 transition-colors"
                    onClick={openBulkEditModal}
                  >
                    edit all metadata
                  </button>
                </div>
              </div>
            </Show>

            {/* Download status summary */}
            <Show when={downloads().length > 0}>
              <div class="mt-4 p-4 border-t border-gray-700">
                <div class="text-sm text-gray-400">
                  {downloads().length} download(s) •
                  {downloads().filter((d) => d.status === "completed").length}{" "}
                  completed •
                  {
                    downloads().filter(
                      (d) => d.status === "queued" || d.status === "downloading"
                    ).length
                  }{" "}
                  in progress
                </div>
              </div>
            </Show>

            {/* Add more music button */}
            <Show when={hasStartedUploads()}>
              <div class="mt-6 pt-4 border-t border-gray-700">
                <div class="flex items-center justify-center">
                  <button
                    class="px-6 py-2 text-sm bg-gray-700 hover:bg-gray-600 border border-gray-600 hover:border-gray-500 transition-colors rounded-md"
                    onClick={handleAddMoreMusic}
                  >
                    + add more music
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </Modal>
  );
}
