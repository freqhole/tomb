/* @jsxImportSource solid-js */
import { createSignal, createEffect, onCleanup } from "solid-js";
import type { Playlist, Song } from "../types/playlist.js";
import { getImageUrlForContext } from "../services/imageService.js";

// Interface for tracking image metadata
interface ImageWithMetadata {
  url: string;
  title: string;
  type: "playlist" | "song";
  id: string;
}

export function useImageModal() {
  // Modal state
  const [showImageModal, setShowImageModal] = createSignal(false);
  const [modalImageIndex, setModalImageIndex] = createSignal(0);
  const [modalImages, setModalImages] = createSignal<ImageWithMetadata[]>([]);

  // Generate image list from playlist and songs
  const generateImageList = (
    playlist: Playlist | null,
    playlistSongs: Song[] = []
  ) => {
    const images: ImageWithMetadata[] = [];

    // Add playlist cover image if available
    if (playlist?.imageType) {
      const playlistImageUrl = getImageUrlForContext(playlist, "modal");
      if (playlistImageUrl) {
        images.push({
          url: playlistImageUrl,
          title: playlist.title,
          type: "playlist",
          id: playlist.id,
        });
      }
    }

    // Add song images
    playlistSongs.forEach((song) => {
      if (song.imageType && (song.imageData || song.thumbnailData)) {
        const songImageUrl = getImageUrlForContext(song, "modal");
        if (songImageUrl) {
          images.push({
            url: songImageUrl,
            title: song.title,
            type: "song",
            id: song.id,
          });
        }
      }
    });

    return images;
  };

  // Open modal with images from playlist and songs
  const openImageModal = (
    playlist: Playlist | null,
    playlistSongs: Song[] = [],
    startIndex: number = 0
  ) => {
    const images = generateImageList(playlist, playlistSongs);
    if (images.length === 0) return;

    setModalImages(images);
    setModalImageIndex(Math.min(startIndex, images.length - 1));
    setShowImageModal(true);
  };

  // Close modal
  const closeImageModal = () => {
    setShowImageModal(false);
    setModalImageIndex(0);
    setModalImages([]);
  };

  // Navigate to next image
  const handleNextImage = () => {
    const images = modalImages();
    if (images.length <= 1) return;

    setModalImageIndex((prev) => (prev + 1) % images.length);
  };

  // Navigate to previous image
  const handlePrevImage = () => {
    const images = modalImages();
    if (images.length <= 1) return;

    setModalImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  // Navigate to specific image
  const goToImage = (index: number) => {
    const images = modalImages();
    if (index >= 0 && index < images.length) {
      setModalImageIndex(index);
    }
  };

  // Get current image URL
  const getCurrentImageUrl = () => {
    const images = modalImages();
    const index = modalImageIndex();
    return images[index]?.url || null;
  };

  // Get current image metadata
  const getCurrentImageMetadata = () => {
    const images = modalImages();
    const index = modalImageIndex();
    return images[index] || null;
  };

  // Get current image title
  const getCurrentImageTitle = () => {
    const images = modalImages();
    const index = modalImageIndex();
    return images[index]?.title || null;
  };

  // Get total image count
  const getImageCount = () => modalImages().length;

  // Get current image index (1-based for display)
  const getCurrentImageNumber = () => modalImageIndex() + 1;

  // Check if there are multiple images
  const hasMultipleImages = () => modalImages().length > 1;

  // Keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!showImageModal()) return;

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeImageModal();
        break;
      case "ArrowLeft":
        e.preventDefault();
        handlePrevImage();
        break;
      case "ArrowRight":
        e.preventDefault();
        handleNextImage();
        break;
      case "Home":
        e.preventDefault();
        goToImage(0);
        break;
      case "End":
        e.preventDefault();
        goToImage(getImageCount() - 1);
        break;
      default:
        // Check for number keys (1-9) to jump to specific images
        const num = parseInt(e.key);
        if (!isNaN(num) && num >= 1 && num <= 9) {
          const targetIndex = num - 1;
          if (targetIndex < getImageCount()) {
            e.preventDefault();
            goToImage(targetIndex);
          }
        }
        break;
    }
  };

  // Set up keyboard event listeners when modal is open
  createEffect(() => {
    if (showImageModal()) {
      document.addEventListener("keydown", handleKeyDown);

      onCleanup(() => {
        document.removeEventListener("keydown", handleKeyDown);
      });
    }
  });

  return {
    // State
    showImageModal,
    modalImageIndex,
    modalImages,

    // Setters
    setShowImageModal,
    setModalImageIndex,

    // Actions
    openImageModal,
    closeImageModal,
    handleNextImage,
    handlePrevImage,
    goToImage,

    // Utilities
    getCurrentImageUrl,
    getCurrentImageMetadata,
    getCurrentImageTitle,
    getImageCount,
    getCurrentImageNumber,
    hasMultipleImages,
    generateImageList,
  };
}
