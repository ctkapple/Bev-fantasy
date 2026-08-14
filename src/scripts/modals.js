// Avatar expand modal and punishment-gallery modal.
// Shared across every league page instead of copy-pasted per file.

function setupAvatarModal() {
  const modal = document.getElementById("avatar-modal");
  const modalImg = document.getElementById("avatar-modal-img");
  const closeBtn = document.getElementById("avatar-modal-close");
  if (!modal || !modalImg) return;

  window.expandAvatar = (src) => {
    modalImg.src = src;
    modal.classList.remove("hidden");
  };
  closeBtn?.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => {
    if (e.target.id === "avatar-modal") modal.classList.add("hidden");
  });
}

function setupPunishmentGallery() {
  const modal = document.getElementById("gallery-modal");
  const modalImg = document.getElementById("gallery-modal-img");
  const closeBtn = document.getElementById("gallery-modal-close");
  const prevBtn = document.getElementById("gallery-prev");
  const nextBtn = document.getElementById("gallery-next");
  const counter = document.getElementById("gallery-counter");
  const ledgerEntries = document.querySelectorAll("[data-gallery]");
  if (!modal || ledgerEntries.length === 0) return;

  let images = [];
  let index = 0;

  const show = (i) => {
    index = i;
    modalImg.src = images[i];
    counter.textContent = `${i + 1} / ${images.length}`;
    prevBtn.style.display = i > 0 ? "flex" : "none";
    nextBtn.style.display = i < images.length - 1 ? "flex" : "none";
    counter.style.display = images.length > 1 ? "block" : "none";
  };

  const open = (galleryJson) => {
    try {
      images = JSON.parse(galleryJson);
    } catch {
      images = [];
    }
    if (images.length === 0) return;
    modal.classList.remove("hidden");
    show(0);
  };

  const close = () => {
    modal.classList.add("hidden");
    modalImg.src = "";
  };

  ledgerEntries.forEach((entry) => {
    entry.addEventListener("click", () => open(entry.dataset.gallery));
  });
  nextBtn?.addEventListener("click", () => index < images.length - 1 && show(index + 1));
  prevBtn?.addEventListener("click", () => index > 0 && show(index - 1));
  closeBtn?.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target.id === "gallery-modal") close();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupAvatarModal();
  setupPunishmentGallery();
});
