(function () {
  var root = document.querySelector('[data-pdf]');
  if (!root) return;
  var images = document.getElementById('imageReader');
  var nativeReader = document.getElementById('nativeReader');
  var mode = document.getElementById('readerMode');
  var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));

  function showImages() {
    nativeReader.hidden = true;
    nativeReader.textContent = '';
    images.hidden = false;
    root.classList.remove('is-native');
    mode.textContent = 'PDF 阅读';
  }

  function showPdf() {
    var object = document.createElement('object');
    object.className = 'calendar-pdf__document';
    object.type = 'application/pdf';
    object.data = root.getAttribute('data-pdf') + '#view=FitH';
    object.setAttribute('aria-label', document.title);
    var fallback = document.createElement('button');
    fallback.type = 'button';
    fallback.className = 'calendar-pdf__fallback';
    fallback.textContent = '切换为逐页阅读';
    fallback.addEventListener('click', showImages);
    object.appendChild(fallback);
    nativeReader.appendChild(object);
    nativeReader.hidden = false;
    images.hidden = true;
    root.classList.add('is-native');
    mode.textContent = '逐页阅读';
  }

  // Mobile WebViews cannot reliably embed PDFs. Keep static pages as the
  // default, including when JavaScript or native PDF support is unavailable.
  if (!mobile) {
    mode.hidden = false;
    if (navigator.pdfViewerEnabled === true) showPdf();
    else mode.textContent = 'PDF 阅读';
    mode.addEventListener('click', function () {
      if (images.hidden) showImages();
      else showPdf();
    });
  }
  // A shared page anchor must open the image reader even on desktop.
  function revealPageAnchor() {
    if (!/^#page-\d+$/.test(location.hash)) return;
    var target = document.getElementById(location.hash.slice(1));
    if (!target) return;
    if (images.hidden) showImages();
    document.getElementById('pageNumber').value = location.hash.slice(6);
    target.scrollIntoView({ block: 'start' });
  }
  window.addEventListener('hashchange', revealPageAnchor);
  revealPageAnchor();
  document.getElementById('pageJump').addEventListener('submit', function (event) {
    event.preventDefault();
    var page = document.getElementById('page-' + Number(document.getElementById('pageNumber').value));
    if (page) page.scrollIntoView({ block: 'start' });
  });
  images.addEventListener('error', function (event) {
    if (event.target.tagName !== 'IMG') return;
    var figure = event.target.closest('figure');
    if (figure.querySelector('button')) return;
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '本页加载失败，点击重试';
    retry.addEventListener('click', function () {
      event.target.src = event.target.src.split('?')[0] + '?retry=' + Date.now();
      retry.remove();
    });
    figure.appendChild(retry);
  }, true);
})();
