interface FileInputCallbacks {
  onFile: (file: File) => void;
}

export function setupFileInput(callbacks: FileInputCallbacks): void {
  const dropZone = document.getElementById('drop-zone')!;
  const fileInput = document.getElementById('file-input') as HTMLInputElement;

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) callbacks.onFile(file);
    // Reset so the same file can be re-selected
    fileInput.value = '';
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-indigo-500', 'bg-gray-900');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-indigo-500', 'bg-gray-900');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-indigo-500', 'bg-gray-900');
    const file = e.dataTransfer?.files[0];
    if (file) callbacks.onFile(file);
  });
}
