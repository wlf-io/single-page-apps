if (window.self !== window.top) {
  const title = document.querySelector("h1");
  if (title) title.hidden = true;
}
