// simple infinite loading
export function useInfiniteLoading(
  onScrollNearBottom?: () => void,
  threshold = 200
) {
  const handleScroll = (e: Event) => {
    const target = e.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;

    if (
      onScrollNearBottom &&
      scrollTop + clientHeight >= scrollHeight - threshold
    ) {
      onScrollNearBottom();
    }
  };

  return { handleScroll };
}
