# Book Shelf

Book Shelf is a private, EPUB-focused fork of [Audiobookshelf](https://github.com/advplyr/audiobookshelf). It keeps Audiobookshelf's reliable library server and PWA while adding synchronized EPUB highlights and bookmarks, iOS-friendly highlighting, portrait covers, Fast Fonts, and an AMOLED reader theme.

The application is served at:

```text
http://YOUR_SERVER_IP:13378/audiobookshelf/
```

## Requirements

- Docker with 64-bit AMD64 or ARM64 support
- Docker Compose v2 for the Compose installation option

The ARM64 image is suitable for a Raspberry Pi running a 64-bit operating system.

## Option 1: Docker Compose

Clone the repository, enter it, and start the container:

```sh
git clone https://github.com/Xinthian/book-shelf.git book-shelf
cd book-shelf
docker compose up -d --build
```

To use a port other than `13378`:

```sh
BOOK_SHELF_PORT=8080 docker compose up -d --build
```

To stop it:

```sh
docker compose down
```

## Option 2: Docker commands

```sh
git clone https://github.com/Xinthian/book-shelf.git book-shelf
cd book-shelf
mkdir -p books config metadata
docker build -t book-shelf:local .
docker run -d \
  --name book-shelf \
  --restart unless-stopped \
  -p 13378:80 \
  -e TZ=UTC \
  -v "$PWD/books:/books" \
  -v "$PWD/config:/config" \
  -v "$PWD/metadata:/metadata" \
  book-shelf:local
```

To stop and remove this container without deleting books or application data:

```sh
docker stop book-shelf
docker rm book-shelf
```

## First-time setup

1. Open `http://YOUR_SERVER_IP:13378/audiobookshelf/`.
2. Create the administrator account.
3. Open settings and create a book library.
4. Add `/books` as its folder.
5. Put EPUBs in the host-side `books` directory, preferably using `Author/Book title/Book.epub`.

The `books`, `config`, and `metadata` directories are deliberately ignored by Git. Back them up separately, especially `config`, which contains the database and user data.

## Updating

After pulling a newer revision:

```sh
docker compose up -d --build
```

For the Docker-command installation, rebuild the image, stop and remove the old container, and repeat the `docker run` command above. Persistent data remains in the bind-mounted host directories.

## Included customizations

- Server-synchronized EPUB highlights, notes, and bookmarks
- Persistent highlight positioning across devices
- iOS/iPadOS reader selection support
- Fast Sans, Fast Serif, and Fast Mono reader fonts
- Reader-only AMOLED theme
- Portrait book covers by default
- "Book Shelf" interface branding
- Narrators shortcut hidden from the library sidebar

Audiobookshelf remains the upstream project and is licensed under GPL-3.0. This fork retains the same license.
