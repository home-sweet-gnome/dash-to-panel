# Basic Makefile

UUID = dash-to-panel@jderose9.github.com
MODULES = src/*.js src/stylesheet.css metadata.json COPYING README.md
UI_MODULES = ui/*.ui
IMAGES = ./* ../media/design/svg/dash-to-panel-logo-light.svg

TOLOCALIZE = src/extension.js src/prefs.js src/appIcons.js src/taskbar.js
MSGSRC = $(wildcard po/*.po)
ifeq ($(strip $(DESTDIR)),)
	INSTALLTYPE = local
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
else
	INSTALLTYPE = system
	INSTALLBASE = $(DESTDIR)/usr/share/gnome-shell/extensions
	SHARE_PREFIX = $(DESTDIR)/usr/share
endif
INSTALLNAME = dash-to-panel@jderose9.github.com

# The command line passed variable VERSION is used to set the version string
# in the metadata and in the generated zip-file. If no VERSION is passed, the
# version is pulled from the latest git tag and the current commit SHA1 is
# added to the metadata
ifdef VERSION
    ifdef TARGET
		FILESUFFIX = _v$(VERSION)_$(TARGET)
	else
		FILESUFFIX = _v$(VERSION)
	endif
else
	LATEST_TAG = $(shell git describe --match "v[0-9]*" --abbrev=0 --tags HEAD)
	VERSION = $(LATEST_TAG:v%=%)
	COMMIT = $(shell git rev-parse HEAD)
	FILESUFFIX =
endif

all: extension

clean:
	rm -f ./schemas/gschemas.compiled
	-rm -fR _build

extension: ./schemas/gschemas.compiled $(MSGSRC:.po=.mo)

./schemas/gschemas.compiled: ./schemas/org.gnome.shell.extensions.dash-to-panel.gschema.xml
	glib-compile-schemas ./schemas/

potfile: ./po/dash-to-panel.pot

mergepo: potfile
	for l in $(MSGSRC); do \
		msgmerge -U $$l ./po/dash-to-panel.pot; \
	done;

./po/dash-to-panel.pot: $(TOLOCALIZE)
	mkdir -p po
	xgettext -k_ -kN_ -o po/dash-to-panel.pot --package-name "Dash To Panel" $(TOLOCALIZE) --from-code=UTF-8

	for l in $(UI_MODULES) ; do \
		intltool-extract --type=gettext/glade $$l; \
		xgettext -k_ -kN_ -o po/dash-to-panel.pot $$l.h --join-existing --from-code=UTF-8; \
		rm -rf $$l.h; \
	done;

	sed -i -e 's/&\#10;/\\n/g' po/dash-to-panel.pot

./po/%.mo: ./po/%.po
	msgfmt -c $< -o $@

install: install-local

install-local: _build
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)
	mkdir -p $(INSTALLBASE)/$(INSTALLNAME)
	cp -r ./_build/* $(INSTALLBASE)/$(INSTALLNAME)/
ifeq ($(INSTALLTYPE),system)
	rm -r $(INSTALLBASE)/$(INSTALLNAME)/schemas $(INSTALLBASE)/$(INSTALLNAME)/locale
	mkdir -p $(SHARE_PREFIX)/glib-2.0/schemas $(SHARE_PREFIX)/locale
	cp -r ./schemas/*gschema.* $(SHARE_PREFIX)/glib-2.0/schemas
	cp -r ./_build/locale/* $(SHARE_PREFIX)/locale
endif
	-rm -fR _build
	echo done

zip-file: _build
	cd _build ; \
	zip -qr "$(UUID)$(FILESUFFIX).zip" .
	mv _build/$(UUID)$(FILESUFFIX).zip ./
	-rm -fR _build

_build: all
	-rm -fR ./_build
	mkdir -p _build
	cp $(MODULES) _build
	mkdir -p _build/ui
	cp $(UI_MODULES) _build/ui

	mkdir -p _build/img
	cd img ; cp $(IMAGES) ../_build/img/
	mkdir -p _build/schemas
	cp schemas/*.xml _build/schemas/
	cp schemas/gschemas.compiled _build/schemas/
	mkdir -p _build/locale
	for l in $(MSGSRC:.po=.mo) ; do \
		lf=_build/locale/`basename $$l .mo`; \
		mkdir -p $$lf; \
		mkdir -p $$lf/LC_MESSAGES; \
		cp $$l $$lf/LC_MESSAGES/dash-to-panel.mo; \
	done;
ifneq ($(and $(COMMIT),$(VERSION)),)
	sed -i 's/"version": [[:digit:]][[:digit:]]*/"version": $(VERSION),\n"commit": "$(COMMIT)"/'  _build/metadata.json;
else ifneq ($(VERSION),)
	sed -i 's/"version": [[:digit:]][[:digit:]]*/"version": $(VERSION)/'  _build/metadata.json;
endif

# Intended use-case: having a second extension called "dash-to-panel-dev" installed
# that can be tested with wayland's support for nested sessions
# Setup (once):
# 	cd ~/.local/share/gnome-shell/extensions
#	ln -s <path/to/cloned/d2p/repo>/_build dash-to-panel-dev@jderose9.github.com
# Build & Debug:
#	make devbuild
#	env MUTTER_DEBUG_DUMMY_MODE_SPECS=1600x900 dbus-run-session -- gnome-shell --nested --wayland
# NOTE: disable original Dash to Panel extension within the nested session BEFORE enabling the devlopment extension!
devbuild: _build
	sed -i \
		-e 's/"extension-id": "dash-to-panel"/"extension-id": "dash-to-panel-dev"/' \
		-e 's/"uuid": "dash-to-panel@jderose9.github.com"/"uuid": "dash-to-panel-dev@jderose9.github.com"/' \
		-e 's/"name": "Dash to Panel"/"name": "Dash to Panel Dev"/' \
		_build/metadata.json
