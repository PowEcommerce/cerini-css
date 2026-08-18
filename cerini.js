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
  var qvStockObs = null; // observes variant selection to gate the CTA on no-stock sizes
  var openToken = 0;     // guards async gallery fetch against rapid re-opens

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
    var src = img.getAttribute("src") || "";
    // Skip inline placeholders (lazy-load gifs); prefer the real source.
    if (!src || src.indexOf("data:") === 0) {
      src = img.getAttribute("data-src") || img.currentSrc || "";
      if ((!src || src.indexOf("data:") === 0)) {
        var ss = img.getAttribute("data-srcset") || img.getAttribute("srcset") || "";
        if (ss) src = ss.split(",").pop().trim().split(" ")[0];
      }
    }
    return src;
  }

  // The product card exposes only its cover image. Fetch the PDP once to get the
  // full gallery so the modal slider + paginator match Figma (multiple images).
  var galleryCache = {};
  function fetchGallery(card, cb) {
    var link = card.querySelector("a.product-item-link, a[href*='/productos/'], a[href]");
    var url = link && link.href;
    var pid = card.getAttribute("data-product-id") || url || "";
    if (!url) { cb(null); return; }
    if (galleryCache[pid]) { cb(galleryCache[pid]); return; }
    if (typeof fetch !== "function" || typeof DOMParser !== "function") { cb(null); return; }
    fetch(url, { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) {
        if (!html) { cb(null); return; }
        var doc = new DOMParser().parseFromString(html, "text/html");
        var slides = doc.querySelectorAll(".js-product-slide");
        var urls = [], seen = {};
        for (var i = 0; i < slides.length; i++) {
          var a = slides[i].querySelector("a.js-product-slide-link, a[href]");
          var u = (a && a.getAttribute("href")) || imgSrc(slides[i].querySelector("img"));
          if (u && u.indexOf("//") === 0) u = "https:" + u;
          if (u && !seen[u]) { seen[u] = 1; urls.push(u); }
        }
        galleryCache[pid] = urls;
        cb(urls.length ? urls : null);
      })
      .catch(function () { cb(null); });
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

  // Native variant label reads "TAMAÑO: 240ml" — Figma wants just "Tamaño".
  // Rewrite each visible group label to the part before the colon (CSS capitalizes it).
  function cleanVariantLabels(form) {
    var labels = form.querySelectorAll(".product-detail-variants-group > label.form-label");
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].getAttribute("data-cerini-clean")) continue;
      labels[i].setAttribute("data-cerini-clean", "1");
      // lowercase so the CSS `text-transform:capitalize` yields "Tamaño", not "TAMAÑO"
      labels[i].textContent = labels[i].textContent.split(":")[0].trim().toLowerCase();
    }
  }
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
        '<header class="cerini-qv-header"><span class="cerini-qv-title">Vista rápida</span></header>' +
        '<button type="button" class="cerini-qv-x" aria-label="Cerrar">' + closeSVG() + "</button>" +
        '<div class="cerini-qv-scroll">' +
          '<div class="cerini-qv-images-wrap">' +
            '<div class="cerini-qv-images"></div>' +
          "</div>" +
          '<div class="cerini-qv-info">' +
            '<div class="cerini-qv-info-main">' +
              '<h2 class="cerini-qv-name"></h2>' +
              '<div class="cerini-qv-attrs" hidden></div>' +
              '<div class="cerini-qv-price"></div>' +
              '<div class="cerini-qv-cuotas" hidden></div>' +
            "</div>" +
            '<div class="cerini-qv-options">' +
              '<a class="cerini-qv-more" href="#">Ver más detalles del producto</a>' +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="cerini-qv-footer"></div>' +
      "</aside>";
    ov.addEventListener("click", function (e) {
      if (e.target === ov) close();
    });
    ov.querySelector(".cerini-qv-x").addEventListener("click", close);
    enableSheetDrag(ov);
    document.body.appendChild(ov);
    return ov;
  }

  // Mobile bottom-sheet: drag the sheet down (from the top, when the content is
  // scrolled to the top) to close it. Past the threshold -> close, else snap back.
  function enableSheetDrag(ov) {
    var modal = ov.querySelector(".cerini-qv-modal");
    var scroll = ov.querySelector(".cerini-qv-scroll");
    var startY = 0, dy = 0, dragging = false;
    function isMobile() { return window.matchMedia("(max-width:767px)").matches; }
    modal.addEventListener("touchstart", function (e) {
      if (!isMobile() || e.touches.length !== 1 || scroll.scrollTop > 0) return;
      startY = e.touches[0].clientY; dy = 0; dragging = true;
      modal.style.transition = "none";
    }, { passive: true });
    modal.addEventListener("touchmove", function (e) {
      if (!dragging) return;
      dy = e.touches[0].clientY - startY;
      // a downward drag while at the top of the content pulls the sheet down
      if (dy <= 0 || scroll.scrollTop > 0) { dy = 0; modal.style.transform = ""; return; }
      modal.style.transform = "translateY(" + dy + "px)";
    }, { passive: true });
    function end() {
      if (!dragging) return;
      dragging = false;
      modal.style.transition = "";
      modal.style.transform = "";
      if (dy > 110) close();
    }
    modal.addEventListener("touchend", end);
    modal.addEventListener("touchcancel", end);
  }

  function renderImages(container, urls) {
    container.innerHTML = "";
    if (!urls.length) { container.parentNode.style.display = "none"; return; }
    container.parentNode.style.display = "";
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
    container.scrollLeft = 0;
  }

  function renderPrice(container, card) {
    container.innerHTML = "";
    var price = card.querySelector(".js-price-display, .product-item-price");
    var compare = card.querySelector(".js-compare-price-display, .product-item-price-compare");
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
    // No cucardas in the quick-view modal: SALE tag and % off badge are omitted.
  }

  function renderAttrs(el, card) {
    // Product attributes row ("Nutrición · Crueltyfree · Todo tipo de cabellos").
    // These are product categories — not in the card DOM. Fed via pre-generated
    // data: a data-cerini-attrs='["a","b","c"]' attribute on the card, or a global
    // window.CERINI_ATTRS = { "<productId>": ["a","b","c"] }. Hidden if absent.
    var raw = card.getAttribute("data-cerini-attrs") || card.getAttribute("data-cerini-highlights");
    var items = null;
    if (raw) { try { items = JSON.parse(raw); } catch (e) { items = null; } }
    if ((!items || !items.length) && window.CERINI_ATTRS) {
      var pid = card.getAttribute("data-product-id");
      if (pid && window.CERINI_ATTRS[pid]) items = window.CERINI_ATTRS[pid];
    }
    if (!items || !items.length) { el.hidden = true; el.innerHTML = ""; return; }
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

    var imagesEl = modalEl.querySelector(".cerini-qv-images");
    renderImages(imagesEl, collectImages(card)); // instant: card cover image
    (function (token) {
      openToken = token;
      fetchGallery(card, function (urls) {
        // ignore if the user already opened a different product meanwhile
        if (openToken === token && urls && urls.length) renderImages(imagesEl, urls);
      });
    })((openToken || 0) + 1);
    modalEl.querySelector(".cerini-qv-name").textContent =
      textOf(card.querySelector(".js-item-name, .product-item-name"));
    renderAttrs(modalEl.querySelector(".cerini-qv-attrs"), card);
    renderPrice(modalEl.querySelector(".cerini-qv-price"), card);

    // Cuotas — rebuilt to Figma format "N cuotas sin interés de $X" from the card spans.
    var cuotas = modalEl.querySelector(".cerini-qv-cuotas");
    var inst = card.querySelector(".js-max-installments-container, .product-item-installments");
    var amt = inst && inst.querySelector(".js-installment-amount, .product-installment-amount");
    var val = inst && inst.querySelector(".js-installment-price, .product-installment-value");
    if (amt && val && textOf(amt) && textOf(val)) {
      var price = textOf(val).replace(/,\d{2}$/, ""); // drop cents to match Figma ($29.983)
      cuotas.innerHTML = '<span class="cerini-qv-cuotas-n"></span> cuotas sin interés de ' +
        '<span class="cerini-qv-cuotas-n"></span>';
      cuotas.children[0].textContent = textOf(amt);
      cuotas.children[1].textContent = price;
      cuotas.hidden = false;
    } else if (inst && textOf(inst)) {
      cuotas.textContent = textOf(inst); cuotas.hidden = false;
    } else { cuotas.hidden = true; }

    var link = card.querySelector("a.product-item-link, a.js-product-item-image-link-private, a[href]");
    modalEl.querySelector(".cerini-qv-more").setAttribute("href", (link && link.href) || "#");

    // Move the native variants + add-to-cart form into the modal (keeps handlers).
    // The "ver más" link is a permanent child of .cerini-qv-options — keep it.
    var options = modalEl.querySelector(".cerini-qv-options");
    var footer = modalEl.querySelector(".cerini-qv-footer");
    var more = options.querySelector(".cerini-qv-more");
    footer.innerHTML = "";
    var form = card.querySelector(".js-item-variants");
    if (form) {
      var ph = document.createComment("cerini-qv-form");
      form.parentNode.insertBefore(ph, form);
      activeForm = { node: form, placeholder: ph };
      form.classList.remove("hidden");
      form.classList.add("cerini-qv-native");
      cleanVariantLabels(form);
      // Mark out-of-stock sizes like the PDP (theme's noStockVariants, exposed on window).
      // Reads the card's data-variants + the variant buttons (still inside the card here).
      if (window.noStockVariants && card.getAttribute("data-variants")) {
        try { window.noStockVariants(card); } catch (e) {}
      }
      options.insertBefore(form, more); // variants above "ver más"
      // Figma order: variants -> "ver más" -> actions (qty + CTA sticky footer).
      // .quickshop-actions lives inside the inner <form>, so insert relative to
      // its real parent (insertBefore throws if the ref node isn't a direct child).
      var actions = form.querySelector(".quickshop-actions");
      if (actions && more) actions.parentNode.insertBefore(more, actions);
    } else {
      activeForm = null;
      // No variant form: out-of-stock -> disabled "Sin stock"; otherwise CTA to product page.
      if (isOutOfStock(card)) {
        footer.innerHTML =
          '<span class="cerini-qv-cta is-disabled" aria-disabled="true">Sin stock</span>';
      } else {
        footer.innerHTML =
          '<a class="cerini-qv-cta" href="' + ((link && link.href) || "#") + '">Ver producto</a>';
      }
    }

    wireQvStockGate(modalEl);

    document.documentElement.classList.add("cerini-qv-lock");
    modalEl.classList.add("is-open");
    requestAnimationFrame(function () { modalEl.classList.add("is-in"); });
    document.addEventListener("keydown", onKey);
  }

  // When the selected size has no stock: CTA -> "Sin stock" (disabled) and block add-to-cart,
  // like the PDP / Kevingston. Restores when a size with stock is selected.
  function wireQvStockGate(modal) {
    if (qvStockObs) { qvStockObs.disconnect(); qvStockObs = null; }
    var options = modal.querySelector(".cerini-qv-options");
    var footer = modal.querySelector(".cerini-qv-footer");
    if (!options || !footer) return;
    function cta() { return footer.querySelector(".js-addtocart") || footer.querySelector('input[type="submit"], button.btn, .btn'); }
    function setLabel(b, t) {
      if (!b) return;
      if (b.tagName === "INPUT") { b.value = t; return; }
      var s = b.querySelector(".js-addtocart-text");
      if (s) s.textContent = t; else b.textContent = t;
    }
    function selNoStock() { return options.querySelector(".js-variant-button.btn-variant-no-stock.selected"); }
    function sync() {
      var b = cta(); if (!b) return;
      if (selNoStock()) {
        b.disabled = true; b.classList.add("is-disabled"); b.setAttribute("aria-disabled", "true");
        setLabel(b, "Sin stock");
      } else {
        b.disabled = false; b.classList.remove("is-disabled"); b.removeAttribute("aria-disabled");
        setLabel(b, b.getAttribute("data-add-to-cart-label") || "Agregar al carrito");
      }
    }
    qvStockObs = new MutationObserver(sync);
    qvStockObs.observe(options, { subtree: true, attributes: true, attributeFilter: ["class"] });
    footer.addEventListener("click", function (e) {
      if (selNoStock() && e.target.closest && e.target.closest(".js-addtocart")) {
        e.preventDefault(); e.stopImmediatePropagation();
      }
    }, true);
    sync();
  }

  function close() {
    if (!modalEl) return;
    if (qvStockObs) { qvStockObs.disconnect(); qvStockObs = null; }
    modalEl.classList.remove("is-in");
    document.documentElement.classList.remove("cerini-qv-lock");
    document.removeEventListener("keydown", onKey);
    // Restore the native form to its card (rescue "ver más" first — it was moved inside the form).
    if (activeForm && activeForm.node) {
      var more = activeForm.node.querySelector(".cerini-qv-more");
      if (more) modalEl.querySelector(".cerini-qv-options").appendChild(more);
    }
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

  /* ---------- card add-ons ---------- */
  // The card carries a hidden stock beacon: data-store="stock-product-<id>-<n>",
  // where <n> is 0 only when the product has no stock (else a number / "infinite").
  function isOutOfStock(card) {
    var s = card.querySelector('[data-store^="stock-product-"]');
    return !!(s && /-0$/.test(s.getAttribute("data-store") || ""));
  }

  function isOnSale(card) {
    var c = card.querySelector(".js-compare-price-display, .product-item-price-compare");
    return !!(c && (c.getAttribute("style") || "").replace(/\s/g, "").indexOf("display:none") === -1 && c.textContent.trim());
  }

  // SALE cucarda over the image (BEST SELLER / CERINI FAV need category data -> later).
  function injectCucardas(card, imgc) {
    if (!isOnSale(card)) return;
    var cont = document.createElement("div");
    cont.className = "cerini-cucardas";
    var sale = document.createElement("span");
    sale.className = "cerini-cucarda cerini-cucarda-sale";
    sale.textContent = "SALE";
    cont.appendChild(sale);
    var host = imgc.querySelector(".product-labels");
    if (host) { host.insertBefore(cont, host.firstChild); }
    else { cont.className += " cerini-cucardas-standalone"; imgc.appendChild(cont); }
  }

  // Quick buy on hover (desktop): size chips over the image; click adds to cart.
  function injectQuickBuy(card, imgc) {
    var form = card.querySelector(".js-item-variants");
    if (!form) return;
    var groups = form.querySelectorAll(".js-product-variants-group");
    if (groups.length !== 1) return; // v1: single variation (size) only
    var btns = groups[0].querySelectorAll(".js-variant-button.btn-variant");
    if (!btns.length) return;
    var bar = document.createElement("div");
    bar.className = "cerini-quickbuy";
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        var chip = document.createElement("button");
        chip.type = "button";
        chip.className = "cerini-quickbuy-chip";
        chip.textContent = (b.getAttribute("data-option") || b.textContent).trim();
        chip.addEventListener("click", function (e) {
          e.preventDefault(); e.stopPropagation();
          b.click(); // native variant selection
          var add = form.querySelector(".js-addtocart, .buy-button-container .btn, [type=submit]");
          if (add) add.click();
        });
        bar.appendChild(chip);
      })(btns[i]);
    }
    imgc.appendChild(bar);
  }

  // Second-image indicator bar (mobile), only when the product has a secondary image.
  function injectSecondImageIndicator(card, imgc) {
    if (!card.querySelector(".product-item-image-secondary")) return;
    var ind = document.createElement("div");
    ind.className = "cerini-img-indicator";
    ind.innerHTML = '<i class="is-active"></i><i></i>';
    imgc.appendChild(ind);
    syncImgIndicator(card, ind);
  }

  // Sync the active dash with the card image slider. LS.productItemSlider renders a
  // "fraction" pagination ("1 / 2") that updates on swipe (kept in the DOM, just hidden);
  // observe it and move .is-active to the matching dash.
  function syncImgIndicator(card, ind, tries) {
    tries = tries || 0;
    var pag = card.querySelector(".js-product-item-slider-pagination, .product-item-slider-pagination");
    if (!pag) { if (tries < 25) setTimeout(function () { syncImgIndicator(card, ind, tries + 1); }, 400); return; }
    var dashes = ind.querySelectorAll("i");
    function update() {
      var m = (pag.textContent || "").match(/\d+/);
      if (!m) return;
      var idx = parseInt(m[0], 10) - 1;
      for (var k = 0; k < dashes.length; k++) dashes[k].classList.toggle("is-active", k === idx);
    }
    new MutationObserver(update).observe(pag, { childList: true, characterData: true, subtree: true });
    update();
  }

  function renderCard(card) {
    if (!card || card.getAttribute(DONE)) return;
    card.setAttribute(DONE, "1");
    var imgc = card.querySelector(".product-item-image-container");
    if (imgc) {
      ensureRelative(imgc);
      injectCucardas(card, imgc);
      injectQuickBuy(card, imgc);
      injectSecondImageIndicator(card, imgc);
      imgc.appendChild(makeEye(card, "mobile"));
    }
    var info = card.querySelector(".product-item-information");
    if (info) { ensureRelative(info); info.appendChild(makeEye(card, "desktop")); }
  }
  function renderAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    if (scope.matches && scope.matches(CARD)) { renderCard(scope); return; }
    var cards = scope.querySelectorAll(CARD);
    for (var i = 0; i < cards.length; i++) renderCard(cards[i]);
  }

  /* ================= Menu drawer (desktop) — Figma 777:20950 =================
   * Left drawer (280px). Category list read from the header nav. Clicking a
   * category with subitems opens a second 280px column with its subcategories.
   * Triggers: header category link (click) + hamburger (on scroll). Desktop only;
   * mobile keeps the native #nav-hamburger menu. */
  var menuEl = null;

  function menuCloseSVG() {
    return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.399 18.308l-.708-.708L11.291 12 5.691 6.4l.708-.708L11.999 11.292l5.6-5.6.708.708L12.707 12l5.6 5.6-.708.708L11.999 12.708z"/></svg>';
  }
  function menuArrowSVG() {
    return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 13.22 10.11 8.11 5 3"/></svg>';
  }
  function menuBackSVG() { // mobile: 20/arrow-left (Figma)
    return '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4 8 12 16 20"/></svg>';
  }
  function menuUserSVG() { // mobile footer: 24/Perfil (Figma 783:21227)
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.999 12.9375C14.588 12.9375 16.686 10.839 16.686 8.25C16.686 5.661 14.588 3.563 11.999 3.563C9.41 3.563 7.312 5.661 7.312 8.25C7.312 10.839 9.41 12.9375 11.999 12.9375Z"/><path d="M19.5 20.437C19.5 16.294 16.144 12.937 12 12.937C7.856 12.937 4.5 16.294 4.5 20.437"/></svg>';
  }
  function isDesktopMenu() { return window.matchMedia("(min-width:768px)").matches; }

  function collectCategories() {
    var out = [];
    var items = document.querySelectorAll(".js-header .nav-desktop-list .nav-main-item");
    for (var i = 0; i < items.length; i++) {
      var link = items[i].querySelector(".nav-list-link");
      if (!link) continue;
      var subs = [];
      var subEls = items[i].querySelectorAll(".desktop-list-subitems > li");
      for (var k = 0; k < subEls.length; k++) {
        var head = subEls[k].querySelector(".nav-list-link-heading, .nav-list-link");
        if (head) subs.push({ name: (head.textContent || "").trim(), url: head.getAttribute("href") || "#" });
      }
      out.push({ name: (link.textContent || "").trim(), url: link.getAttribute("href") || "#", subs: subs });
    }
    return out;
  }

  function buildMenu() {
    var cats = collectCategories();
    var lg = document.querySelector(".js-header .logo-img");
    var logoSrc = lg ? (lg.getAttribute("src") || "") : "";
    var acc = document.querySelector(".js-header .header-account a[href]");
    var loginUrl = acc ? acc.getAttribute("href") : "#";
    var logoImg = logoSrc ? '<img src="' + logoSrc + '" alt="Cerini Beauty">' : "";
    var catsHtml = "";
    for (var i = 0; i < cats.length; i++) {
      var hasSub = cats[i].subs.length > 0;
      catsHtml += '<li><a class="cerini-menu-cat' + (hasSub ? " has-sub" : "") + '" href="' + cats[i].url +
        '" data-idx="' + i + '"><span>' + cats[i].name + "</span>" +
        (hasSub ? '<span class="cerini-menu-arrow">' + menuArrowSVG() + "</span>" : "") + "</a></li>";
    }
    var ov = document.createElement("div");
    ov.className = "cerini-menu-overlay";
    ov.innerHTML =
      '<aside class="cerini-menu-panel">' +
        // mobile top bar (back + logo + close); hidden on desktop
        '<div class="cerini-menu-topbar">' +
          '<button type="button" class="cerini-menu-back" aria-label="Volver">' + menuBackSVG() + "</button>" +
          '<span class="cerini-menu-tb-logo">' + logoImg + "</span>" +
          '<button type="button" class="cerini-menu-tb-close" aria-label="Cerrar">' + menuCloseSVG() + "</button>" +
        "</div>" +
        '<div class="cerini-menu-col1">' +
          '<button type="button" class="cerini-menu-close" aria-label="Cerrar">' + menuCloseSVG() + "</button>" +
          '<ul class="cerini-menu-cats list-unstyled">' + catsHtml + "</ul>" +
          '<div class="cerini-menu-promo"><div class="cerini-menu-promo-img"></div>' +
            '<a class="cerini-menu-promo-link" href="#">DESCUBRIR</a></div>' +
          (logoSrc ? '<a class="cerini-menu-logo" href="/">' + logoImg + "</a>" : "") +
        "</div>" +
        '<div class="cerini-menu-col2"></div>' +
        // mobile bottom bar (INICIAR SESIÓN); hidden on desktop
        '<a class="cerini-menu-footer" href="' + loginUrl + '">' + menuUserSVG() + "<span>INICIAR SESIÓN</span></a>" +
      "</aside>";
    ov._cats = cats;
    ov.addEventListener("click", function (e) { if (e.target === ov) closeMenu(); });
    ov.querySelector(".cerini-menu-close").addEventListener("click", closeMenu);
    ov.querySelector(".cerini-menu-tb-close").addEventListener("click", closeMenu);
    ov.querySelector(".cerini-menu-back").addEventListener("click", function () {
      ov.classList.remove("is-expanded");
      var its = ov.querySelectorAll(".cerini-menu-cat");
      for (var m = 0; m < its.length; m++) its[m].classList.remove("is-active");
    });
    var catLinks = ov.querySelectorAll(".cerini-menu-cat");
    for (var j = 0; j < catLinks.length; j++) {
      catLinks[j].addEventListener("click", function (e) {
        var idx = +this.getAttribute("data-idx");
        if (cats[idx] && cats[idx].subs.length) { e.preventDefault(); selectCat(idx); }
      });
    }
    document.body.appendChild(ov);
    return ov;
  }

  function selectCat(idx) {
    if (!menuEl) return;
    var cats = menuEl._cats, c = cats[idx];
    var items = menuEl.querySelectorAll(".cerini-menu-cat");
    for (var i = 0; i < items.length; i++) items[i].classList.toggle("is-active", +items[i].getAttribute("data-idx") === idx);
    if (!c || !c.subs.length) { menuEl.classList.remove("is-expanded"); return; }
    var html = "";
    for (var k = 0; k < c.subs.length; k++) html += '<li><a href="' + c.subs[k].url + '">' + c.subs[k].name + "</a></li>";
    menuEl.querySelector(".cerini-menu-col2").innerHTML = '<ul class="cerini-menu-subs list-unstyled">' + html + "</ul>";
    menuEl.classList.add("is-expanded");
  }

  function openMenu(selIdx) {
    if (!menuEl) menuEl = buildMenu();
    var fromHeader = typeof selIdx === "number" && selIdx >= 0;
    document.documentElement.classList.add("cerini-qv-lock");
    menuEl.classList.remove("is-expanded", "is-firstopen");
    menuEl.classList.add("is-open");
    if (fromHeader) menuEl.classList.add("is-firstopen"); // 2nd column enters with 150ms delay
    requestAnimationFrame(function () {
      menuEl.classList.add("is-in");
      if (fromHeader) selectCat(selIdx);
    });
    if (fromHeader) setTimeout(function () { if (menuEl) menuEl.classList.remove("is-firstopen"); }, 700);
    document.addEventListener("keydown", onMenuKey);
  }
  function closeMenu() {
    if (!menuEl) return;
    menuEl.classList.remove("is-in", "is-expanded");
    document.documentElement.classList.remove("cerini-qv-lock");
    document.removeEventListener("keydown", onMenuKey);
    var el = menuEl;
    setTimeout(function () { el.classList.remove("is-open"); }, 350);
  }
  function onMenuKey(e) { if (e.key === "Escape" || e.keyCode === 27) closeMenu(); }

  function wireMenuTriggers() {
    var catLinks = document.querySelectorAll(".js-header .nav-desktop-list .nav-main-item > .nav-list-link");
    for (var i = 0; i < catLinks.length; i++) {
      (function (idx) {
        catLinks[idx].addEventListener("click", function (e) {
          if (!isDesktopMenu()) return;
          e.preventDefault(); openMenu(idx);
        });
      })(i);
    }
    var burgers = document.querySelectorAll(".js-header .menu-container .js-modal-open-private");
    for (var b = 0; b < burgers.length; b++) {
      burgers[b].addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation(); openMenu(-1); // desktop + mobile (custom drawer)
      }, true);
    }
  }

  /* ================= Footer (Figma 1077:28029) ================= */
  function setupFooter() {
    var CDN = "https://powecommerce.github.io/cerini-css/";
    // footer logo — crisp vector CERINI BEAUTY (native block only renders a logo
    // when the setting is set; inject into .footer-contact-info-container)
    var fcont = document.querySelector(".footer-contact-info-container");
    if (fcont && !fcont.querySelector(".cerini-footer-logo")) {
      var wrap = document.createElement("a");
      wrap.className = "cerini-footer-logo";
      wrap.href = "/";
      wrap.innerHTML = '<img class="cerini-footer-logo-img" src="' + CDN + 'cerini-logo.svg" alt="Cerini Beauty">';
      fcont.appendChild(wrap);
    }
    // copyright -> "© Cerini <year>." (Figma) with a dynamic year
    var cr = document.querySelector(".footer-copyright");
    if (cr) cr.textContent = "© Cerini " + new Date().getFullYear() + ".";
    // POW branding in the bottom bar (theme only renders "creado con tiendanube")
    var pb = document.querySelector(".footer-legal-container .footer-powered-by");
    if (pb && !document.querySelector(".cerini-pow")) {
      var pow = document.createElement("span");
      pow.className = "cerini-pow";
      pow.innerHTML = '<img src="' + CDN + 'pow.svg" alt="Powered and Developed by POW">';
      pb.parentNode.insertBefore(pow, pb.nextSibling);
    }
    // newsletter: add a "nombre" field before the email (Figma: nombre + email)
    var wrap = document.querySelector(".footer-newsletter-form .newsletter-form-wrapper");
    var email = wrap && wrap.querySelector('input[type="email"]');
    if (email) email.setAttribute("placeholder", "Ingresá tu e-mail");
    if (wrap && email && !wrap.querySelector(".cerini-nl-name")) {
      var name = document.createElement("input");
      name.type = "text";
      name.name = "name";
      name.autocomplete = "name";
      name.className = "cerini-nl-name newsletter-form-input";
      name.placeholder = "Ingresá tu nombre";
      name.setAttribute("aria-label", "Ingresá tu nombre");
      wrap.insertBefore(name, email);
    }
  }

  // Home · Novedades carousel: 4.1 slides on desktop, move 1 at a time, no pagination.
  function setupNovedadesCarousel() {
    var section = document.querySelector('[data-section-id="novedades"]');
    if (!section) return;
    var slider = section.querySelector(".js-products-list-swiper");
    var wrapper = section.querySelector(".js-swiper-products-slider");
    if (!slider || !wrapper) return;
    var tries = 0;
    (function apply() {
      tries++;
      if (!window.Swiper) { if (tries < 40) setTimeout(apply, 100); return; }
      // let the theme create its instance first, then override cleanly
      if (!slider.swiper && tries < 15) { setTimeout(apply, 100); return; }
      var colMob = parseInt(wrapper.dataset.mobileColumns, 10) || 2;
      if (slider.swiper) { try { slider.swiper.destroy(true, true); } catch (e) {} }
      new window.Swiper(slider, {
        lazy: true,
        slidesPerView: colMob,
        slidesPerGroup: 1,
        spaceBetween: 16,
        watchOverflow: true,
        breakpoints: { 768: { slidesPerView: 4.1, slidesPerGroup: 1 } }
      });
    })();
  }

  // Home · Best sellers carousel: move 1 at a time + progress scrollbar paginator (the line under it).
  function setupBestSellersCarousel() {
    var section = document.querySelector("#ns-section-best_sellers");
    if (!section) return;
    var slider = section.querySelector(".js-products-list-swiper");
    var wrapper = section.querySelector(".js-swiper-products-slider");
    var host = section.querySelector("#ns-block-products") || section;
    if (!slider || !wrapper) return;
    var tries = 0;
    (function apply() {
      tries++;
      if (!window.Swiper) { if (tries < 40) setTimeout(apply, 100); return; }
      if (!slider.swiper && tries < 15) { setTimeout(apply, 100); return; }
      var colD = parseInt(wrapper.dataset.desktopColumns, 10) || 4;
      var colM = parseInt(wrapper.dataset.mobileColumns, 10) || 2;
      if (slider.swiper) { try { slider.swiper.destroy(true, true); } catch (e) {} }
      var sb = host.querySelector(".cerini-bs-progress");
      if (!sb) { sb = document.createElement("div"); sb.className = "cerini-bs-progress"; host.appendChild(sb); }
      new window.Swiper(slider, {
        lazy: true,
        slidesPerView: colM,
        slidesPerGroup: 1,
        spaceBetween: 16,
        watchOverflow: true,
        pagination: { el: sb, type: "progressbar" },
        breakpoints: { 768: { slidesPerView: colD, slidesPerGroup: 1 } }
      });
    })();
  }

  // Home · Nuestras marcas — continuous logo marquee (spec 08), like the pre-header ticker.
  // Ribbon scrolls right→left at 40px/s, linear, infinite; pauses on hover; per-brand hover bg.
  // Built from the theme's brand logos, duplicated ×2 (each set includes a trailing gap so
  // translateX(-50%) is seamless). animation-duration = setWidth / 40px/s, recalculated by count.
  var BRAND_ITEM_W = 168, BRAND_GAP = 62, BRAND_SPEED = 40; // px / px / px-per-second
  function setupBrandsMarquee() {
    var section = document.querySelector(".featured-brands-section");
    if (!section || section.querySelector(".brands-marquee")) return;
    var slider = section.querySelector(".js-carousel-slider");
    if (!slider) return;
    var tries = 0;
    (function apply() {
      tries++;
      var slides = [].slice.call(slider.querySelectorAll(".brand-logo-slide"));
      if (!slides.length) { if (tries < 30) setTimeout(apply, 150); return; }
      var links = slides.map(function (sl) {
        return sl.querySelector(".brand-logo-link") || sl.firstElementChild;
      }).filter(Boolean);
      if (!links.length) return;
      if (slider.swiper) { try { slider.swiper.destroy(true, true); } catch (e) {} }

      function buildSet() {
        var set = document.createElement("div");
        set.className = "brands-set";
        links.forEach(function (lk) {
          var item = document.createElement("div");
          item.className = "brand-marquee-item";
          var clone = lk.cloneNode(true);
          [].slice.call(clone.querySelectorAll("img")).forEach(function (img) {
            // KEEP the full srcset (the responsive sizes) so the browser can pick a
            // sharp version — stripping it left only the tiny base src (50x23 → looked blank).
            var dss = img.getAttribute("data-srcset"), ds = img.getAttribute("data-src");
            if (dss && !img.getAttribute("srcset")) img.setAttribute("srcset", dss);
            var cur = img.getAttribute("src") || "";
            if (ds && (cur === "" || cur.indexOf("data:") === 0)) img.setAttribute("src", ds);
            img.setAttribute("sizes", "200px"); // pick a candidate ~200px (item is 168px)
            img.removeAttribute("loading");
            img.classList.remove("lazyload", "swiper-lazy");
          });
          item.appendChild(clone);
          set.appendChild(item);
        });
        return set;
      }
      var marquee = document.createElement("div");
      marquee.className = "brands-marquee";
      var track = document.createElement("div");
      track.className = "brands-track";
      track.appendChild(buildSet());
      track.appendChild(buildSet());
      marquee.appendChild(track);
      slider.parentNode.replaceChild(marquee, slider);
      // setWidth = N items * itemW + N gaps (N-1 inner + 1 trailing) = N*(itemW+gap); dur = setWidth/speed
      var setWidth = links.length * (BRAND_ITEM_W + BRAND_GAP);
      track.style.animationDuration = (setWidth / BRAND_SPEED) + "s";
    })();
  }

  // PDP · turn the description block into a Figma-style accordion tab ("Descripción").
  // "Modo de uso" / "Highlights" tabs need custom fields (fork) — only Descripción exists here.
  function setupPdpTabs() {
    if (!document.querySelector(".js-product-detail")) return; // product page only
    // description may render as a block in product_info AND/OR as its own section — handle all
    var blocks = document.querySelectorAll(".product-info-description");
    for (var i = 0; i < blocks.length; i++) {
      (function (desc) {
        if (desc.getAttribute("data-cerini-acc")) return;
        var body = desc.querySelector(".js-product-description, .product-description-content");
        if (!body) return;
        var head = desc.querySelector(".product-description-heading");
        if (!head) { // theme hid the title -> create one so we get the accordion header
          head = document.createElement("h3");
          head.className = "product-description-heading";
          head.textContent = "Descripción";
          desc.insertBefore(head, desc.firstChild);
        } else if (!head.textContent.trim()) {
          head.textContent = "Descripción";
        }
        desc.setAttribute("data-cerini-acc", "1");
        desc.classList.add("cerini-pdp-acc", "is-collapsed");
        var ic = document.createElement("span");
        ic.className = "cerini-pdp-acc-ic";
        head.appendChild(ic);
        head.style.cursor = "pointer";
        head.addEventListener("click", function () { desc.classList.toggle("is-collapsed"); });
      })(blocks[i]);
    }
  }

  // PDP · inject side arrows on the main image slider (mobile shows them; desktop uses thumbs).
  // They drive the theme's own swiper on .js-product-slider.
  function setupPdpGalleryArrows() {
    var pdp = document.querySelector(".js-product-detail");
    if (!pdp) return;
    var wrap = pdp.querySelector(".product-images-slider");
    var slider = pdp.querySelector(".js-product-slider");
    if (!wrap || !slider || wrap.querySelector(".cerini-pdp-nav")) return;
    var CH = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M15 5l-7 7 7 7" stroke="#000" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    function mk(dir) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cerini-pdp-nav cerini-pdp-nav-" + dir;
      b.setAttribute("aria-label", dir === "prev" ? "Anterior" : "Siguiente");
      b.innerHTML = CH;
      b.addEventListener("click", function () {
        var sw = slider.swiper;
        if (sw) { dir === "prev" ? sw.slidePrev() : sw.slideNext(); }
      });
      return b;
    }
    wrap.appendChild(mk("prev"));
    wrap.appendChild(mk("next"));
  }

  function init() {
    renderAll(document);
    wireMenuTriggers();
    setupFooter();
    setupNovedadesCarousel();
    setupBestSellersCarousel();
    setupBrandsMarquee();
    setupPdpTabs();
    setupPdpGalleryArrows();
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
