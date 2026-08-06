// Click-to-collapse game sections (Championships, Toilet Bowl), matching the
// original site's behavior where each season's header toggles its detail grid.

function toggle(header) {
  const target = document.getElementById(header.dataset.target);
  if (!target) return;
  const nowHidden = target.classList.toggle("hidden");
  header.setAttribute("aria-expanded", String(!nowHidden));
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".game-toggle[data-target]").forEach((header) => {
    header.addEventListener("click", () => toggle(header));
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle(header);
      }
    });
  });
});
