import re

with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# Replace head
new_head = '''<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DAG-MILE — Intelligent Dataset Preparation</title>
  
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'sans-serif'], mono: ['ui-monospace', 'monospace'] },
          colors: { teal: { 500: '#34C7A0', 600: '#1E8A6C', 700: '#166550' } }
        }
      }
    };
  </script>
  
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
  <script src="https://unpkg.com/lucide@latest"></script>
  <link rel="stylesheet" href="style.css">
</head>'''
html = re.sub(r'<head>.*?</head>', new_head, html, flags=re.DOTALL)

# Replace Body Tag
html = html.replace('<body>', '<body class="bg-slate-50 text-slate-800 font-sans antialiased min-h-screen">')

# Remove inline styles that clash with Tailwind
html = re.sub(r'<style>.*?</style>', '', html, flags=re.DOTALL)

# Replace common classes
html = html.replace('class="app hidden"', 'class="app hidden max-w-5xl mx-auto px-4 py-8"')
html = html.replace('class="topbar"', 'class="topbar flex flex-col sm:flex-row sm:items-center justify-between gap-6 p-6 mb-8 bg-white/80 backdrop-blur-md border border-slate-200 rounded-2xl shadow-sm sticky top-4 z-40"')
html = html.replace('class="brand"', 'class="brand flex items-center gap-3"')
html = html.replace('class="logo"', 'class="logo text-teal-600 font-bold text-2xl"')
html = html.replace('class="step"', 'class="step px-3 py-1.5 text-sm font-medium text-slate-500 rounded-md cursor-pointer hover:bg-slate-100 hover:text-slate-900 transition-colors"')
html = html.replace('class="step active"', 'class="step active px-3 py-1.5 text-sm font-medium bg-teal-50 text-teal-700 rounded-md cursor-default"')

# Panels
html = html.replace('class="panel"', 'class="panel bg-white border border-slate-200 shadow-sm rounded-2xl p-8 mb-8"')
html = html.replace('class="panel hidden"', 'class="panel hidden bg-white border border-slate-200 shadow-sm rounded-2xl p-8 mb-8"')

# Headings
html = html.replace('class="section-eyebrow"', 'class="section-eyebrow text-xs font-semibold tracking-wider text-teal-600 uppercase mb-2 block"')
html = html.replace('<h2>', '<h2 class="text-2xl font-bold text-slate-900 mb-2">')
html = html.replace('<p class="muted">', '<p class="muted text-slate-500 mb-8">')
html = html.replace('<h3>', '<h3 class="text-lg font-semibold text-slate-900 mt-8 mb-2">')

# Buttons
html = html.replace('class="btn primary"', 'class="btn primary px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded-lg shadow-sm transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"')
html = html.replace('class="btn secondary"', 'class="btn secondary px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg shadow-sm transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"')
html = html.replace('class="btn ghost"', 'class="btn ghost px-4 py-2.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 font-medium rounded-lg transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"')

# Forms & Inputs (Basic)
html = html.replace('<input type="email"', '<input type="email" class="w-full px-4 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-shadow"')
html = html.replace('<input type="password"', '<input type="password" class="w-full px-4 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-shadow"')
html = html.replace('<input type="text"', '<input type="text" class="w-full px-4 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-shadow"')
html = html.replace('<select', '<select class="w-full px-4 py-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-shadow cursor-pointer"')

# Home Grid
html = html.replace('class="home-grid"', 'class="home-grid grid grid-cols-1 md:grid-cols-3 gap-6"')
html = html.replace('class="home-card rounded-2xl"', 'class="home-card bg-white border border-slate-200 p-6 rounded-2xl shadow-sm hover:shadow-md transition-shadow"')
html = html.replace('class="home-card-label"', 'class="home-card-label text-xs font-semibold text-teal-600 tracking-wider mb-2 block uppercase"')

# Auth Layout
html = html.replace('id="publicHome"', 'id="publicHome" class="max-w-6xl mx-auto pt-16 px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center"')
html = html.replace('class="eyebrow"', 'class="eyebrow text-teal-600 font-mono text-sm tracking-widest uppercase mb-4 block"')
html = html.replace('<h1>', '<h1 class="text-4xl sm:text-5xl font-bold text-slate-900 mb-6 leading-tight">')
html = html.replace('class="lead"', 'class="lead text-xl text-slate-500 mb-6"')
html = html.replace('class="intro-description"', 'class="intro-description text-slate-500 mb-8"')
html = html.replace('class="project-points"', 'class="project-points space-y-4"')
html = html.replace('<li class="rounded-xl">', '<li class="p-4 bg-white border-l-4 border-teal-500 rounded-r-xl shadow-sm">')

# Auth Form Container
html = html.replace('id="authScreen" class="rounded-2xl"', 'id="authScreen" class="bg-white border border-slate-200 shadow-xl rounded-3xl p-8"')
html = html.replace('id="authTabs"', 'id="authTabs" class="flex gap-6 border-b border-slate-200 mb-6"')
html = html.replace('data-auth-tab="login" type="button"', 'data-auth-tab="login" type="button" class="pb-3 border-b-2 font-medium text-slate-500 hover:text-slate-900 transition-colors"')
html = html.replace('data-auth-tab="register" type="button"', 'data-auth-tab="register" type="button" class="pb-3 border-b-2 font-medium text-slate-500 hover:text-slate-900 transition-colors"')

# Icons replacement
html = html.replace('<span class="logo">⛁</span>', '<i data-lucide="database" class="w-8 h-8 text-teal-600"></i>')
html = html.replace('<span class="dropzone-icon">↥</span>', '<i data-lucide="upload-cloud" class="w-12 h-12 text-teal-500 mx-auto mb-4"></i>')
html = html.replace('← Back', '<i data-lucide="arrow-left" class="w-4 h-4"></i> Back')
html = html.replace('Analyze →', 'Analyze <i data-lucide="arrow-right" class="w-4 h-4"></i>')
html = html.replace('Continue →', 'Continue <i data-lucide="arrow-right" class="w-4 h-4"></i>')
html = html.replace('Apply transformations →', 'Apply transformations <i data-lucide="sparkles" class="w-4 h-4"></i>')

# Add Alpine x-data where helpful without breaking pure JS. Let's not risk x-data if pure js is controlling it, just Tailwind styling is fine.

with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
