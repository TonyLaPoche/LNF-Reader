# LNF-Reader

Lecteur web pour lire des light novels et des web novels au format .epub et .pdf accès simple sans passer par des stores.

Adresse : [https://tonylapoche.github.io/LNF-Reader/](https://tonylapoche.github.io/LNF-Reader/)

L’application ne contient aucun roman. Il faut déjà avoir les fichiers sur le téléphone ou l’ordinateur, puis les importer.

## Ce que l’app fait

- Lit des fichiers `.epub` et `.pdf`.
- Regroupe les volumes d’un même roman (par exemple `Mushoku Tensei_ Jobless Reincarnation Vol. 10.epub`).
- Garde la position de lecture sur l’appareil.
- S’installe comme un raccourci, au même titre qu’une application.
- Permet de marquer un chapitre lu, non lu, ou lu jusqu’au chapitre choisi.
- Sur une page en image, le zoom à deux doigts agrandit une zone, puis un doigt la déplace.
- Pour un EPUB en anglais, propose une traduction vers le français, chapitre par chapitre ou pour tout le livre.

## Ce que l’app ne fait pas

- Elle ne télécharge pas les romans. Il n’y a pas de catalogue ni de lien vers des fichiers.
- Elle n’envoie pas les livres sur un serveur. Le fichier et la progression restent dans le navigateur.
- La traduction n’est pas celle d’un traducteur. Elle utilise [Transformers.js](https://github.com/huggingface/transformers.js), une librairie open source. Le résultat n’est pas fiable à 100 %. Le modèle (environ 80 Mo) n’est téléchargé que si une traduction est lancée.

## Importer un roman

1. Télécharge les `.epub` ou les `.pdf` sur l’appareil.
2. Ouvre LNF Reader.
3. Appuie sur **Importer** et choisis les fichiers dans les téléchargements. Plusieurs volumes peuvent être sélectionnés d’un coup.
4. Ouvre le roman, puis le chapitre.

## Installer sur le téléphone

Le bouton **Installer**, à côté d’**Importer**, sert à garder l’app sur l’écran d’accueil.

- Android : le navigateur propose d’installer l’application.
- iPhone : Safari ne le fait pas tout seul. Le bouton indique le geste : **Partager**, puis **Sur l’écran d’accueil**.

Une fois installée, l’app s’ouvre sans la barre du navigateur. Le bouton retour du téléphone ramène d’abord à la liste des chapitres, puis à la bibliothèque.

## Lecture

- Swipe vers la gauche ou vers le haut : page suivante.
- Swipe vers la droite ou vers le bas : page précédente.
- Sur ordinateur, un swipe trackpad à deux doigts fait la même chose, une page par geste. De droite à gauche pour avancer, de gauche à droite pour revenir.
- La barre en bas du chapitre règle la page, la taille du texte et le thème. Elle ne recouvre pas le texte.

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir `http://localhost:5173/LNF-Reader/`.
