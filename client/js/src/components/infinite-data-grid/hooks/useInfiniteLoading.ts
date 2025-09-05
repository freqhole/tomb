// simple infinite loading with smart buffer
export function useInfiniteLoading(onScrollNearBottom?: () => void) {
  const handleScroll = (e: Event) => {
    const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
    const target = e.target as HTMLDivElement;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;

    // smart buffer: 15% of container height, but between 50px and 300px
    const bufferPercent = 0.15;
    const minBuffer = 50;
    const maxBuffer = 300;
    const buffer = Math.max(
      minBuffer,
      Math.min(maxBuffer, clientHeight * bufferPercent)
    );

    console.log(
      `[${timestamp}] scroll: top=${Math.round(scrollTop)}, height=${Math.round(scrollHeight)}, client=${Math.round(clientHeight)}, buffer=${Math.round(buffer)}, nearBottom=${scrollTop + clientHeight >= scrollHeight - buffer}`
    );

    if (
      onScrollNearBottom &&
      scrollTop + clientHeight >= scrollHeight - buffer
    ) {
      console.log(`[${timestamp}] TRIGGER LOAD!`);
      onScrollNearBottom();
    }
  };

  return { handleScroll };
}
