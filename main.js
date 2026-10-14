(function () {
  var nav = document.getElementById('nav');
  var burger = document.getElementById('burger');
  var menu = document.getElementById('menu');

  window.addEventListener('scroll', function () {
    nav.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  burger.addEventListener('click', function () {
    var open = menu.classList.toggle('open');
    burger.setAttribute('aria-expanded', open);
  });
  menu.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') {
      menu.classList.remove('open');
      burger.setAttribute('aria-expanded', false);
    }
  });

  document.getElementById('yr').textContent = new Date().getFullYear();

  function count(el) {
    var end = +el.dataset.count, suffix = el.dataset.suffix || '', start = performance.now(), dur = 1400;
    (function tick(t) {
      var p = Math.min((t - start) / dur, 1);
      el.textContent = Math.round(end * (1 - Math.pow(1 - p, 3))) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    })(start);
  }

  var items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in'); });
    document.querySelectorAll('[data-count]').forEach(count);
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return;
      en.target.classList.add('in');
      en.target.querySelectorAll('[data-count]').forEach(count);
      io.unobserve(en.target);
    });
  }, { threshold: 0.12 });
  items.forEach(function (el, i) {
    el.style.transitionDelay = (i % 3) * 80 + 'ms';
    io.observe(el);
  });
})();
