/* ==================================================================
 * Cerini — storefront enhancement layer (compose-only)
 * Injected via a <script> in a Code block (templates/pages/*.json).
 * Reads existing product-card markup and adds Figma features that the
 * unforked theme can't render natively.
 *
 *   - Quick view (ojito) on every product card.
 *   - Custom "Vista rápida" modal (Figma 1074:24144):
 *       desktop = right drawer (442px), mobile = bottom sheet.
 *       Populated from the card DOM. The native variants+add-to-cart
 *       form (.js-item-variants) is MOVED in so the cart keeps working,
 *       then moved back on close.
 * ================================================================== */
(function () {
  "use strict";

  var CARD = ".js-item-product[data-product-id]";
  var DONE = "data-cerini-qv";
  var modalEl = null;
  var activeForm = null; // { node, placeholder } for restoring the moved native form

  /* ---------- icons ---------- */
  function eyeSVG() {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      '<path d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 ' +
      '8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 ' +
      '0-8.573-3.007-9.964-7.178Z"/><circle cx="12" cy="12" r="3"/></svg>'
    );
  }
  function closeSVG() {
    return (
      '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" ' +
      'stroke-linecap="round" aria-hidden="true"><path d="M4 4l12 12M16 4L4 16"/></svg>'
    );
  }

  /* ---------- helpers ---------- */
  function imgSrc(img) {
    if (!img) return "";
    return img.getAttribute("src") || img.getAttribute("data-src") ||
      (img.currentSrc || "");
  }

  function collectImages(card) {
    var urls = [];
    var seen = {};
    var imgs = card.querySelectorAll(".product-item-image, .product-item-image-secondary, .product-item-slider-slide img, img");
    for (var i = 0; i < imgs.length; i++) {
      var s = imgSrc(imgs[i]);
      if (s && !seen[s] && s.indexOf("data:image") !== 0) { seen[s] = 1; urls.push(s); }
    }
    return urls;
  }

  function textOf(el) { return el ? el.textContent.trim() : ""; }
  function isVisible(el) {
    return el && el.offsetParent !== null &&
      !(el.getAttribute("style") || "").replace(/\s/g, "").indexOf("display:none") >= 0;
  }

  /* ---------- modal DOM ---------- */
  function buildModalShell() {
    var ov = document.createElement("div");
    ov.className = "cerini-qv-overlay";
    ov.innerHTML =
      '<aside class="cerini-qv-modal" role="dialog" aria-modal="true" aria-label="Vista rápida">' +
        '<div class="cerini-qv-header">' +
          '<span class="cerini-qv-title">Vista rápida</span>' +
          '<button type="button" class="cerini-qv-x" aria-label="Cerrar">' + closeSVG() + "</button>" +
        "</div>" +
        '<div class="cerini-qv-scroll">' +
          '<div class="cerini-qv-images"></div>' +
          '<div class="cerini-qv-info">' +
            '<h2 class="cerini-qv-name"></h2>' +
            '<div class="cerini-qv-highlights" hidden></div>' +
            '<div class="cerini-qv-price"></div>' +
            '<div class="cerini-qv-cuotas" hidden></div>' +
            '<div class="cerini-qv-options"></div>' +
            '<a class="cerini-qv-more" href="#">Ver más detalles del producto</a>' +
          "</div>" +
        "</div>" +
        '<div class="cerini-qv-footer"></div>' +
      "</aside>";
    ov.addEventListener("click", function (e) {
      if (e.target === ov) close();
    });
    ov.querySelector(".cerini-qv-x").addEventListener("click", close);
    document.body.appendChild(ov);
    return ov;
  }

  function renderImages(container, urls) {
    container.innerHTML = "";
    if (!urls.length) { container.style.display = "none"; return; }
    container.style.display = "";
    urls.forEach(function (u) {
      var slide = document.createElement("div");
      slide.className = "cerini-qv-slide";
      var im = document.createElement("img");
      im.src = u;
      im.alt = "";
      im.loading = "lazy";
      slide.appendChild(im);
      container.appendChild(slide);
    });
  }

  function renderPrice(container, card) {
    container.innerHTML = "";
    var price = card.querySelector(".js-price-display, .product-item-price");
    var compare = card.querySelector(".js-compare-price-display, .product-item-price-compare");
    var discount = card.querySelector(".product-item-discount");
    var hasCompare = compare && (compare.getAttribute("style") || "").replace(/\s/g, "").indexOf("display:none") === -1 && textOf(compare);
    if (hasCompare) {
      var c = document.createElement("span");
      c.className = "cerini-qv-compare";
      c.textContent = textOf(compare);
      container.appendChild(c);
    }
    var p = document.createElement("span");
    p.className = "cerini-qv-price-main" + (hasCompare ? " is-sale" : "");
    p.textContent = textOf(price);
    container.appendChild(p);
    var hasDiscount = discount && (discount.getAttribute("style") || "").replace(/\s/g, "").indexOf("display:none") === -1 && textOf(discount);
    if (hasDiscount) {
      var d = document.createElement("span");
      d.className = "cerini-qv-discount";
      d.textContent = textOf(discount);
      container.appendChild(d);
    }
  }

  function renderHighlights(el, card) {
    // Highlights come from product custom fields — not in the card DOM yet.
    // Supported via a pre-generated data attribute: data-cerini-highlights='["a","b","c"]'
    var raw = card.getAttribute("data-cerini-highlights");
    if (!raw) { el.hidden = true; return; }
    var items;
    try { items = JSON.parse(raw); } catch (e) { items = null; }
    if (!items || !items.length) { el.hidden = true; return; }
    el.innerHTML = "";
    items.slice(0, 3).forEach(function (t, i) {
      if (i) { var sep = document.createElement("span"); sep.className = "cerini-qv-sep"; sep.textContent = "·"; el.appendChild(sep); }
      var s = document.createElement("span"); s.textContent = t; el.appendChild(s);
    });
    el.hidden = false;
  }

  /* ---------- open / close ---------- */
  function open(card) {
    if (!modalEl) modalEl = buildModalShell();

    renderImages(modalEl.querySelector(".cerini-qv-images"), collectImages(card));
    modalEl.querySelector(".cerini-qv-name").textContent =
      textOf(card.querySelector(".js-item-name, .product-item-name"));
    renderHighlights(modalEl.querySelector(".cerini-qv-highlights"), card);
    renderPrice(modalEl.querySelector(".cerini-qv-price"), card);

    var cuotas = modalEl.querySelector(".cerini-qv-cuotas");
    var inst = card.querySelector(".product-item-installments");
    if (inst && textOf(inst)) { cuotas.textContent = textOf(inst); cuotas.hidden = false; }
    else { cuotas.hidden = true; }

    var link = card.querySelector("a.product-item-link, a.js-product-item-image-link-private, a[href]");
    modalEl.querySelector(".cerini-qv-more").setAttribute("href", (link && link.href) || "#");

    // Move the native variants + add-to-cart form into the modal (keeps handlers).
    var options = modalEl.querySelector(".cerini-qv-options");
    var footer = modalEl.querySelector(".cerini-qv-footer");
    options.innerHTML = "";
    footer.innerHTML = "";
    var form = card.querySelector(".js-item-variants");
    if (form) {
      var ph = document.createComment("cerini-qv-form");
      form.parentNode.insertBefore(ph, form);
      activeForm = { node: form, placeholder: ph };
      form.classList.remove("hidden");
      form.classList.add("cerini-qv-native");
      options.appendChild(form);
    } else {
      activeForm = null;
      // Simple product (no variants): footer CTA links to the product page.
      footer.innerHTML =
        '<a class="cerini-qv-cta" href="' + ((link && link.href) || "#") + '">Ver producto</a>';
    }

    document.documentElement.classList.add("cerini-qv-lock");
    modalEl.classList.add("is-open");
    requestAnimationFrame(function () { modalEl.classList.add("is-in"); });
    document.addEventListener("keydown", onKey);
  }

  function close() {
    if (!modalEl) return;
    modalEl.classList.remove("is-in");
    document.documentElement.classList.remove("cerini-qv-lock");
    document.removeEventListener("keydown", onKey);
    // Restore the native form to its card.
    if (activeForm && activeForm.placeholder && activeForm.placeholder.parentNode) {
      activeForm.node.classList.remove("cerini-qv-native");
      activeForm.node.classList.add("hidden");
      activeForm.placeholder.parentNode.insertBefore(activeForm.node, activeForm.placeholder);
      activeForm.placeholder.parentNode.removeChild(activeForm.placeholder);
    }
    activeForm = null;
    var m = modalEl;
    setTimeout(function () { if (m) m.classList.remove("is-open"); }, 300);
  }

  function onKey(e) { if (e.key === "Escape") close(); }

  /* ---------- eye injection ---------- */
  function makeEye(card, context) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cerini-qv-eye cerini-qv-eye-" + context;
    btn.setAttribute("aria-label", "Vista rápida");
    btn.setAttribute("title", "Vista rápida");
    btn.innerHTML = eyeSVG();
    btn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation(); open(card);
    });
    return btn;
  }
  function ensureRelative(el) {
    if (el && getComputedStyle(el).position === "static") el.style.position = "relative";
  }
  function renderCard(card) {
    if (!card || card.getAttribute(DONE)) return;
    card.setAttribute(DONE, "1");
    var imgc = card.querySelector(".product-item-image-container");
    if (imgc) { ensureRelative(imgc); imgc.appendChild(makeEye(card, "mobile")); }
    var info = card.querySelector(".product-item-information");
    if (info) { ensureRelative(info); info.appendChild(makeEye(card, "desktop")); }
  }
  function renderAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches(CARD)) { renderCard(scope); return; }
    var cards = scope.querySelectorAll(CARD);
    for (var i = 0; i < cards.length; i++) renderCard(cards[i]);
  }

  function init() {
    renderAll(document);
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          if (added[j].nodeType === 1) renderAll(added[j]);
        }
      }
    });
    if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
