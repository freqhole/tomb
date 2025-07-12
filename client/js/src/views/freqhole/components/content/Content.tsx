export function Content(props: any) {
  return (
    <div class="bg-black flex flex-col h-full">
      <div class="flex-1 overflow-y-auto">{props.children}</div>
    </div>
  );
}
