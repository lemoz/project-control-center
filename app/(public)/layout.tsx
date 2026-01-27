const publicLayoutStyles = `
  .container {
    max-width: none;
    margin: 0;
    padding: 0;
  }
  .container > header {
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
