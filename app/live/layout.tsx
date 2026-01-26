const liveLayoutStyles = `
  .container {
    max-width: none;
    margin: 0;
    padding: 0;
    width: 100%;
  }
  .container > header {
    display: none !important;
  }
`;

export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: liveLayoutStyles }} />
      {children}
    </>
  );
}
