"use strict";

const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu-button]");
const nav = document.querySelector("[data-nav]");

function updateHeader() {
  header?.classList.toggle("is-scrolled", window.scrollY > 20);
}

function closeMenu() {
  nav?.classList.remove("is-open");
  menuButton?.classList.remove("is-open");
  menuButton?.setAttribute("aria-expanded", "false");
  menuButton?.setAttribute("aria-label", "Open menu");
}

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

menuButton?.addEventListener("click", () => {
  const willOpen = !nav.classList.contains("is-open");
  nav.classList.toggle("is-open", willOpen);
  menuButton.classList.toggle("is-open", willOpen);
  menuButton.setAttribute("aria-expanded", String(willOpen));
  menuButton.setAttribute("aria-label", willOpen ? "Close menu" : "Open menu");
});

nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
window.addEventListener("resize", () => { if (window.innerWidth > 720) closeMenu(); });

const revealItems = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}
