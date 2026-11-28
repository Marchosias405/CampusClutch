const lookup = document.querySelector('.lookup');
if (lookup) {
  lookup.addEventListener('submit', () => {
    const field = lookup.elements.namedItem('code');
    field.value = field.value.trim().toUpperCase().replace(/^([A-Z]+)\s*(\d)/, '$1 $2');
  });
}
