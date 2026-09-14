with open('app.js', 'r', encoding='utf-8') as f:
    app_js = f.read()

app_js = app_js.replace('function navigateToStep(stepName) {', 'function navigateToStep(stepName) {\n  setTimeout(() => { if(window.lucide) lucide.createIcons(); }, 50);')

app_js += '\n\ndocument.addEventListener("DOMContentLoaded", () => {\n  if(window.lucide) lucide.createIcons();\n});\n'

with open('app.js', 'w', encoding='utf-8') as f:
    f.write(app_js)
