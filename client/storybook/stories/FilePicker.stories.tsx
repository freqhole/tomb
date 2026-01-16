import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { Button } from "../src/components/buttons/Button";
import { FilePicker } from "../src/components/upload/FilePicker";

const meta = {
  title: "Components/Upload/FilePicker",
  component: FilePicker,
  tags: ["autodocs"],
  argTypes: {
    multiple: {
      control: "boolean",
      description: "allow multiple file selection",
    },
    allowDragAndDrop: {
      control: "boolean",
      description: "enable drag and drop",
    },
    disabled: {
      control: "boolean",
      description: "disable the picker",
    },
  },
} satisfies Meta<typeof FilePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

// interactive example with full state management
export const Interactive: Story = {
  render: () => {
    const [files, setFiles] = createSignal<File[]>([]);

    const handleFileAccept = (acceptedFiles: File[]) => {
      console.log("files accepted:", acceptedFiles);
      setFiles((prev) => [...prev, ...acceptedFiles]);
    };

    const handleFileReject = (rejections: any[]) => {
      console.log("files rejected:", rejections);
    };

    const handleFileChange = (details: any) => {
      console.log("file list changed:", details);
    };

    return (
      <div class="space-y-4">
        <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
          <div class="caption text-[var(--color-text-muted)]">
            drag files into the dropzone or click "choose files" to select
          </div>
        </div>

        <FilePicker
          label="upload files"
          hint="you can upload multiple files at once"
          multiple
          maxFiles={5}
          onFileAccept={handleFileAccept}
          onFileReject={handleFileReject}
          onFileChange={handleFileChange}
        />

        {files().length > 0 && (
          <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
            <div class="body-sm text-[var(--color-text-secondary)] mb-2">
              uploaded files: {files().length}
            </div>
            <ul class="caption text-[var(--color-text-muted)] space-y-1">
              {files().map((file) => (
                <li>
                  {file.name} ({(file.size / 1024).toFixed(2)} KB)
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  },
};

// single file picker
export const SingleFile: Story = {
  args: {
    label: "choose a file",
    hint: "select one file to upload",
    onFileAccept: (files) => console.log("accepted:", files),
  },
};

// multiple files
export const MultipleFiles: Story = {
  args: {
    label: "choose multiple files",
    hint: "you can select up to 10 files",
    multiple: true,
    maxFiles: 10,
    onFileAccept: (files) => console.log("accepted:", files),
  },
};

// image only
export const ImagesOnly: Story = {
  args: {
    label: "upload images",
    hint: "only image files are accepted",
    multiple: true,
    accept: "image/*",
    onFileAccept: (files) => console.log("accepted:", files),
  },
};

// with file size limits
export const WithSizeLimits: Story = {
  args: {
    label: "upload with size limits",
    hint: "files must be between 1KB and 5MB",
    multiple: true,
    maxFileSize: 5 * 1024 * 1024, // 5MB
    minFileSize: 1024, // 1KB
    onFileAccept: (files) => console.log("accepted:", files),
    onFileReject: (rejections) => console.log("rejected:", rejections),
  },
};

// specific file types
export const SpecificFileTypes: Story = {
  args: {
    label: "upload documents",
    hint: "only PDF and Word documents are accepted",
    multiple: true,
    accept: [".pdf", ".doc", ".docx"],
    onFileAccept: (files) => console.log("accepted:", files),
  },
};

// with error state
export const WithError: Story = {
  args: {
    label: "upload files",
    error: "file size exceeds maximum allowed size",
    multiple: true,
    onFileAccept: (files) => console.log("accepted:", files),
  },
};

// disabled state
export const Disabled: Story = {
  args: {
    label: "upload files",
    hint: "file upload is currently disabled",
    disabled: true,
    multiple: true,
  },
};

// without drag and drop
export const WithoutDragAndDrop: Story = {
  args: {
    label: "choose files",
    hint: "click the button to select files",
    allowDragAndDrop: false,
    multiple: true,
    onFileAccept: (files) => console.log("accepted:", files),
  },
};

// avatar upload example
export const AvatarUpload: Story = {
  render: () => {
    const [previewUrl, setPreviewUrl] = createSignal<string | null>(null);

    const handleFileAccept = (files: File[]) => {
      if (files.length > 0) {
        const file = files[0];
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
      }
    };

    return (
      <div class="space-y-4 max-w-md">
        {previewUrl() && (
          <div class="flex justify-center">
            <img
              src={previewUrl()!}
              alt="avatar preview"
              class="w-32 h-32 rounded-full object-cover border-2 border-[var(--color-accent-500)]"
            />
          </div>
        )}

        <FilePicker
          label="upload avatar"
          hint="square images work best (max 2MB)"
          accept="image/*"
          maxFileSize={2 * 1024 * 1024}
          onFileAccept={handleFileAccept}
        />
      </div>
    );
  },
};

// playlist cover upload example
export const PlaylistCover: Story = {
  render: () => {
    const [coverUrl, setCoverUrl] = createSignal<string | null>(null);

    const handleFileAccept = (files: File[]) => {
      if (files.length > 0) {
        const file = files[0];
        const url = URL.createObjectURL(file);
        setCoverUrl(url);
      }
    };

    return (
      <div class="space-y-4 max-w-lg">
        <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
          <div class="caption text-[var(--color-text-muted)]">
            upload a cover image for your playlist
          </div>
        </div>

        {coverUrl() && (
          <div class="aspect-square rounded overflow-hidden">
            <img
              src={coverUrl()!}
              alt="playlist cover"
              class="w-full h-full object-cover"
            />
          </div>
        )}

        <FilePicker
          label="playlist cover"
          hint="recommended: 1000x1000px, max 5MB"
          accept="image/*"
          maxFileSize={5 * 1024 * 1024}
          onFileAccept={handleFileAccept}
        />
      </div>
    );
  },
};

// music file upload example
export const MusicUpload: Story = {
  render: () => {
    const [uploadedFiles, setUploadedFiles] = createSignal<File[]>([]);
    const [uploading, setUploading] = createSignal(false);

    const handleFileAccept = (files: File[]) => {
      setUploadedFiles(files);
    };

    const handleUpload = async () => {
      setUploading(true);
      // simulate upload
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setUploading(false);
      alert(`uploaded ${uploadedFiles().length} file(s)!`);
      setUploadedFiles([]);
    };

    return (
      <div class="space-y-4 max-w-2xl">
        <div class="p-4 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded">
          <div class="body-sm text-[var(--color-text-secondary)] mb-2">
            upload music files to your library
          </div>
          <div class="caption text-[var(--color-text-muted)]">
            supported formats: MP3, FLAC, OGG, M4A
          </div>
        </div>

        <FilePicker
          label="select music files"
          hint="you can upload multiple files at once"
          multiple
          maxFiles={20}
          accept={[".mp3", ".flac", ".ogg", ".m4a"]}
          maxFileSize={50 * 1024 * 1024} // 50MB
          onFileAccept={handleFileAccept}
        />

        {uploadedFiles().length > 0 && (
          <Button
            variant="primary"
            onClick={handleUpload}
            disabled={uploading()}
            class="w-full"
          >
            {uploading()
              ? `uploading ${uploadedFiles().length} file(s)...`
              : `upload ${uploadedFiles().length} file(s)`}
          </Button>
        )}
      </div>
    );
  },
};

// validation example
export const WithValidation: Story = {
  render: () => {
    const [error, setError] = createSignal<string | undefined>(undefined);

    const validateFile = (file: File) => {
      // custom validation: filename cannot contain spaces
      if (file.name.includes(" ")) {
        return [
          {
            code: "invalid-filename",
            message: "filename cannot contain spaces",
          },
        ];
      }
      return null;
    };

    const handleFileAccept = (files: File[]) => {
      setError(undefined);
      console.log("accepted:", files);
    };

    const handleFileReject = (rejections: any[]) => {
      if (rejections.length > 0) {
        const rejection = rejections[0];
        if (rejection.errors?.[0]) {
          setError(rejection.errors[0].message);
        }
      }
      console.log("rejected:", rejections);
    };

    return (
      <FilePicker
        label="upload with custom validation"
        hint="filenames cannot contain spaces"
        error={error()}
        multiple
        validateFile={validateFile}
        onFileAccept={handleFileAccept}
        onFileReject={handleFileReject}
      />
    );
  },
};

// compact version
export const Compact: Story = {
  render: () => (
    <div class="max-w-md">
      <FilePicker
        hint="drag files here or click to choose"
        multiple
        maxFiles={5}
        onFileAccept={(files) => console.log("accepted:", files)}
      />
    </div>
  ),
};
