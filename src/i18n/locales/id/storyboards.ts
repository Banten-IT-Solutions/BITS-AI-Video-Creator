const storyboards: Record<string, string> = {
  // Page header & library sidebar
  "storyboards.eyebrow": "Studio native",
  "storyboards.title": "Storyboard",
  "storyboards.description":
    "Bentuk video dari adegan hingga shot. Setiap prompt, catatan kamera, dan baris voiceover tersimpan lokal di pustaka Anda sendiri.",
  "storyboards.newStoryboard": "Storyboard baru",
  "storyboards.searchPlaceholder": "Cari storyboard…",
  "storyboards.searchAria": "Cari storyboard",
  "storyboards.loadingLibrary": "Memuat pustaka…",
  "storyboards.emptyLibrary": "Studio Anda masih kosong. Buat storyboard untuk memulai.",
  "storyboards.noMatch": "Tidak ada storyboard yang cocok dengan pencarian ini.",
  "storyboards.createFirst": "Buat yang pertama",
  "storyboards.sceneCount": "{count} adegan",
  "storyboards.shotCount": "{count} shot",
  "storyboards.edited": "Diedit {time}",
  "storyboards.sqliteNote":
    "Storyboard tersimpan di SQLite. Ekspor ringkasan Markdown yang bersih atau snapshot JSON kapan saja.",
  "storyboards.loadingStoryboard": "Memuat storyboard…",
  "storyboards.openError": "Tidak dapat membuka storyboard ini",
  "storyboards.emptyTitle": "Satu frame kosong menanti",
  "storyboards.emptyDescription":
    "Buat storyboard untuk membuat sketsa adegan, menulis shot, dan melampirkan voiceover pada setiap adegan.",

  // Dirty guards (non-React)
  "storyboards.dirtyGuard": "Storyboard ini memiliki perubahan yang belum disimpan. Buang perubahan tersebut?",
  "storyboards.navigateDirtyGuard": "Buang perubahan storyboard yang belum disimpan?",

  // Page-level toasts
  "storyboards.createdToastTitle": "Storyboard dibuat",
  "storyboards.createdToastBody": "Mulai tambahkan adegan, prompt, dan voiceover.",
  "storyboards.createError": "Tidak dapat membuat storyboard",
  "storyboards.deletedToastTitle": "Storyboard dihapus",
  "storyboards.deletedToastBody": "File voiceover yang dihasilkan tetap ada di disk.",
  "storyboards.deleteError": "Tidak dapat menghapus storyboard",
  "storyboards.duplicatedToastTitle": "Storyboard diduplikasi",
  "storyboards.duplicatedToastBody": "Salinannya independen dan siap diedit.",
  "storyboards.duplicateError": "Tidak dapat menduplikasi storyboard",

  // Create dialog
  "storyboards.createTitle": "Storyboard baru",
  "storyboards.createDescription": "Beri judul kerja pada karya ini. Semuanya dapat diubah nanti.",
  "storyboards.createButton": "Buat storyboard",
  "storyboards.fieldTitle": "Judul",
  "storyboards.titlePlaceholder": "Cahaya terakhir di Banten",
  "storyboards.fieldLogline": "Logline",
  "storyboards.loglineHint": "Satu atau dua kalimat yang menjaga fokus penyuntingan.",
  "storyboards.loglinePlaceholder":
    "Seorang kurir melintasi pesisir sebelum matahari terbenam untuk mengantarkan pesan yang mengubah segalanya.",
  "storyboards.fieldStyle": "Gaya visual",
  "storyboards.stylePlaceholder": "Sinematik hangat",
  "storyboards.fieldAspectRatio": "Rasio aspek",

  // Editor header card
  "storyboards.saveToastTitle": "Storyboard tersimpan",
  "storyboards.saveToastBody": "Catatan adegan dan voiceover tersimpan lokal.",
  "storyboards.saveError": "Tidak dapat menyimpan storyboard",
  "storyboards.filterJson": "Storyboard JSON",
  "storyboards.filterBrief": "Ringkasan storyboard",
  "storyboards.exportedToastTitle": "Storyboard diekspor",
  "storyboards.exportedJsonToast": "Snapshot JSON telah ditulis.",
  "storyboards.exportedMarkdownToast": "Ringkasan Markdown telah ditulis.",
  "storyboards.exportError": "Tidak dapat mengekspor storyboard",
  "storyboards.sectionLabel": "Storyboard",
  "storyboards.unsaved": "Belum disimpan",
  "storyboards.saved": "Tersimpan",
  "storyboards.untitled": "Storyboard tanpa judul",
  "storyboards.aspect": "Rasio {ratio}",
  "storyboards.duplicateAria": "Duplikasi storyboard",
  "storyboards.exportAria": "Ekspor storyboard",
  "storyboards.deleteAria": "Hapus storyboard",
  "storyboards.loglineEditorPlaceholder": "Apa yang berubah antara frame pertama dan frame terakhir?",

  // Scenes
  "storyboards.scenesHeading": "Adegan",
  "storyboards.scenesDescription": "Setiap adegan memuat shot, bahasa kamera, dialog, dan satu script voiceover.",
  "storyboards.addScene": "Tambah adegan",
  "storyboards.noScenesTitle": "Belum ada adegan",
  "storyboards.noScenesDescription":
    "Tambahkan adegan, lalu pecah menjadi shot. Sebuah adegan bisa sekecil satu gambar atau sebesar satu rangkaian.",
  "storyboards.addFirstScene": "Tambah adegan pertama",
  "storyboards.sceneTitleAria": "Judul adegan {index}",
  "storyboards.scenePlaceholder": "Adegan {index}",
  "storyboards.moveSceneUp": "Naikkan adegan",
  "storyboards.moveSceneDown": "Turunkan adegan",
  "storyboards.removeScene": "Hapus adegan",
  "storyboards.fieldSceneDirection": "Arahan adegan",
  "storyboards.sceneDirectionPlaceholder": "Apa yang dilihat dan dirasakan penonton dalam adegan ini.",
  "storyboards.fieldLocation": "Lokasi",
  "storyboards.locationPlaceholder": "Pelabuhan saat fajar",
  "storyboards.fieldTimeOfDay": "Waktu",
  "storyboards.timeOfDayPlaceholder": "Jam biru",

  // Scene voiceover
  "storyboards.voiceoverLabel": "Voiceover",
  "storyboards.voiceoverHint": "Opsional · satu script per adegan",
  "storyboards.voiceoverPlaceholder": "Kalimat yang menghidupkan adegan ini…",
  "storyboards.voiceoverAria": "Voiceover adegan {index}",

  // Shots
  "storyboards.shotLabel": "SHOT {scene}.{shot}",
  "storyboards.moveShotUp": "Naikkan shot",
  "storyboards.moveShotDown": "Turunkan shot",
  "storyboards.removeShot": "Hapus shot",
  "storyboards.fieldShotDescription": "Deskripsi shot",
  "storyboards.shotDescriptionPlaceholder": "Close-up tangan yang membuka amplop.",
  "storyboards.fieldDuration": "Durasi",
  "storyboards.durationHint": "1–600 detik",
  "storyboards.fieldPrompt": "Prompt generate",
  "storyboards.promptHint": "Instruksi visual yang akan Anda tempelkan ke model video.",
  "storyboards.promptPlaceholder":
    "Film 35mm hangat, matahari rendah menembus kabut pelabuhan, close-up handheld yang intim…",
  "storyboards.fieldCamera": "Kamera",
  "storyboards.cameraPlaceholder": "Dolly in perlahan",
  "storyboards.fieldDialogue": "Dialog",
  "storyboards.dialoguePlaceholder": "Kita mulai dari sini.",
  "storyboards.fieldTransition": "Transisi",
  "storyboards.transitionPlaceholder": "Cut",
  "storyboards.addShot": "Tambah shot",

  // Voiceover CTA
  "storyboards.voiceoverCtaTitle": "Siap mendengarnya?",
  "storyboards.voiceoverCtaBody": "Buka studio Voiceover untuk mempratinjau atau membuat audio adegan.",
  "storyboards.openVoiceover": "Buka voiceover",

  // Delete confirmation
  "storyboards.deleteConfirmTitle": "Hapus storyboard?",
  "storyboards.deleteConfirmBody":
    "dan rencana adegannya akan dihapus dari perangkat ini. File audio yang dihasilkan tetap berada di lokasi penyimpanannya.",
  "storyboards.deleteConfirmButton": "Hapus storyboard",

  // Export dialog
  "storyboards.exportTitle": "Ekspor storyboard",
  "storyboards.exportDescription":
    "Pilih format. Ringkasan Markdown dapat dibaca di mana saja; JSON menyimpan seluruh hasil suntingan.",
  "storyboards.markdownBrief": "Ringkasan Markdown",
  "storyboards.markdownBriefDesc": "Adegan, shot, prompt, dan voiceover dalam satu dokumen.",
  "storyboards.jsonSnapshot": "Snapshot JSON",
  "storyboards.jsonSnapshotDesc": "Cadangan portabel dari model storyboard yang lengkap.",
};

export default storyboards;
