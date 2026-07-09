// Inline, render-blocking script that sets the `dark` class on <html> BEFORE
// first paint — eliminates the light→dark flash on reload for dark-mode users.
// Reads the same `rihla_dark` localStorage key the ThemeToggle writes.
export default function ThemeScript() {
  const code = `(function(){try{var d=localStorage.getItem('rihla_dark');if(d==='1')document.documentElement.classList.add('dark');}catch(e){}})();`;
  // eslint-disable-next-line react/no-danger
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
