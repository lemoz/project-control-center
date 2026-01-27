const publicLayoutStyles = `
  .container {
    max-width: none;
    margin: 0;
    padding: 0;
  }
  .container > header {
    display: none !important;
  }
  /* Hide chat widget on public pages */
  [class*="chatWidget"],
  [class*="ChatWidget"],
  .chat-widget {
    display: none !important;
  }
`;

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: publicLayoutStyles }} />
      {children}
    </>
  );
}
