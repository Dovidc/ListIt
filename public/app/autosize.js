// Auto-resize textareas
function autosize(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
}

document.addEventListener('input', (e) => {
    if (e.target && e.target.tagName === 'TEXTAREA') autosize(e.target);
});

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('textarea').forEach(autosize);
});
