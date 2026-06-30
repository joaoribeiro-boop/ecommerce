/* Ao clicar no ícone da extensão, abre a interface em uma aba. */
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("app.html") });
});
