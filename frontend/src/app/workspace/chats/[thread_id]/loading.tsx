export default function ChatLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="text-muted-foreground p-10 text-sm"
    >
      正在打开对话…
    </div>
  );
}
