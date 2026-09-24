const parts = [
  "app.parts/01.txt",
  "app.parts/02.txt",
  "app.parts/03.txt",
  "app.parts/04.txt"
];

let source = "";
for (const part of parts) {
  const response = await fetch(new URL(part, import.meta.url));
  if (!response.ok) throw new Error(`Could not load ${part}: ${response.status}`);
  source += await response.text();
}

const moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
try {
  await import(moduleUrl);
} finally {
  URL.revokeObjectURL(moduleUrl);
}
