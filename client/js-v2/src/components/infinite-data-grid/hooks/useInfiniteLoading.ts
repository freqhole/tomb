// simple infinite loading with smart buffer
export function useInfiniteLoading(onScrollNearBottom?: () => void) {
  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;

    // smart buffer: 25% of container height, but between 50px and 500px
    const bufferPercent = 0.25;
    const minBuffer = 50;
    const maxBuffer = 500;
    const buffer = Math.max(
      minBuffer,
      Math.min(maxBuffer, clientHeight * bufferPercent)
    );

    if (
      onScrollNearBottom &&
      scrollTop + clientHeight >= scrollHeight - buffer
    ) {
      onScrollNearBottom();
    }
  };

  return { handleScroll };
}
