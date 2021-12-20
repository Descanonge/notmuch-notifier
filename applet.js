const Applet = imports.ui.applet;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Lang = imports.lang;

const Settings = imports.ui.settings;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;

const uuid = "notmuch-notifier@cinnamon.org"

function MailItem(mail) {
    this._init(mail);
}

function run_cmd(command) {
    try {
        let [result, stdout, stderr] = GLib.spawn_command_line_sync(command);
        if (stdout != null) {
            return stdout.toString();
        }
    }
    catch(e) {
        global.logError(e);
    }

    return "";
}

MailItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(mail) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);

        try {
            this.id = mail.thread;
            this.subject = mail.subject;
            this.sender = mail.authors;

            this._hBox = new St.BoxLayout({vertical: false});
            this._label = new St.BoxLayout({vertical: true});
            this._buttons = new St.BoxLayout({vertical: false});

            this.make_label();
            this.make_buttons();
            this._hBox.add(this._label, {expand: true});
            this._hBox.add(this._buttons, {align: St.Align.END});

            this.addActor(this._hBox, {expand: true});

        } catch (e) {
            global.logError(e);
        }
    },

    make_label: function() {
        this._sender_label = new St.Label(
            {text: this.sender, style_class: "notmuch-sender-label"});
        this._subject_label = new St.Label(
            {text: this.subject, style_class: "notmuch-subject-label"});

        this._label.add(this._sender_label);
        this._label.add(this._subject_label);

    },

    _make_icon: function(name) {
        let icon = new St.Icon({
            icon_name: name,
            icon_type: St.IconType.SYMBOLIC,
            icon_size: 20,
            style: "popup-menu-icon"
        })
        return icon;
    },

    make_buttons: function() {
        this._btn_archive = new St.Button({child: this._make_icon("archive")});
        this._btn_trash = new St.Button({child: this._make_icon("edit-clear-history")});
        this._btn_delete = new St.Button({child: this._make_icon("edit-delete")});
        let kw = {expand: false, align: St.Align.END, spacing: 12};
        this._buttons.add(this._btn_archive, kw);
        this._buttons.add(this._btn_trash, kw);
        this._buttons.add(this._btn_delete, kw);
    },

    activate: function(event, keepMenu) {
        this.emit('activate', event, true);
    }

}


function NotmuchNotifier(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

NotmuchNotifier.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        try {
            this.metadata = metadata;
            this.instance_id = instance_id;

            this.set_applet_icon_symbolic_name("mail-unread");
            this.set_applet_label("");

            this.settings = new Settings.AppletSettings(this, metadata.uuid, instance_id);
            this.settings.bind("update-interval", "update_interval", this._new_interval);
            this.settings.bind("max-mail-summary", "max_mail_summary", this.max_mail_summary);

            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation, {sensitive: false});
            this.menuManager.addMenu(this.menu);

            this.mail_count = 0;
            this.mail_unread = false;
            this.mail_items = [];
            this._update_loop();
        } catch(e) {
            global.logError(e);
        }
    },

    _new_interval: function() {
        if (this._updateLoopID) {
            Mainloop.source_remove(this._updateLoopID);
        }
        this._update_loop();
    },

    on_applet_clicked: function() {
        if (!this.menu.isOpen) {
            this.load_menu();
        }
        this.menu.toggle();
        run_cmd("notmuch tag -unread tag:inbox and tag:unread");
        this.update_label();
    },

    _onButtonPressEvent: function(actor, event) {
        if (event.get_button() == 2) {
            this.update_label();
        }
        return Applet.Applet.prototype._onButtonPressEvent.call(this, actor, event);
    },

    on_applet_removed_from_panel: function() {
        if (this._updateLoopID) {
            Mainloop.source_remove(this._updateLoopID);
        }
    },

    get_messages: function() {
        let count = run_cmd("notmuch count tag:inbox");
        this.mail_unread = (run_cmd("notmuch count tag:inbox and tag:unread") > 0);
        this.mail_count = count.replace( /[\r\n]+/gm, "" );
    },

    get_messages_summary: function() {
        let mails_s = run_cmd(`notmuch search --format=json --limit=${this.max_mail_summary} tag:inbox`);
        if (mails_s != "") {
            try {
                for (var mail of JSON.parse(mails_s)) {
                    this.mail_items.push(new MailItem(mail));
                }
            } catch (e) {
                global.logError(e);
            }
        }
    },

    update_label: function() {
        this.get_messages();
        this.set_applet_label(this.mail_count);
        if (this.mail_count == 0) {
            this.hide_applet_label(true);
        } else {
            this.hide_applet_label(false);
        }
        if (this.mail_unread) {
            this.set_applet_icon_symbolic_name("mail-unread");
        } else {
            this.set_applet_icon_symbolic_name("mail-read");
        }
    },

    _update_loop: function() {
        this.update_label();
        this._updateLoopID = Mainloop.timeout_add(this.update_interval*1000,
                                                  Lang.bind(this, this._update_loop));
    },

    bind_remove: function(btn, mi, tag) {
        let func = function(){
            run_cmd(`notmuch tag ${tag} -- thread:${mi.id}`);
            this.load_menu();
            this.menu.toggle();
            // mi.destroy();
            // this.update_label();
        }
        btn.connect('clicked', Lang.bind(this, func));
    },

    load_menu: function() {
        this.mail_items = [];
        this.menu.removeAll();
        this.update_label();
        this.get_messages_summary();
        let count = 1;
        for (var mi of this.mail_items) {
            if (count > this.max_mail_summary) {
                this.menu.addAction(_("..."));
                break;
            }
            count ++;
            this.menu.addMenuItem(mi);
            this.bind_remove(mi._btn_archive, mi, '-inbox')
            this.bind_remove(mi._btn_trash, mi, '+trashed')
            this.bind_remove(mi._btn_delete, mi, '+deleted')

        }
        if (this.mail_count == 0) {
            this._noUnreadItem = this.menu.addAction(_("No mail in inbox."));
        }
    },

}

function main(metadata, orientation, panel_height, instance_id) {
    return new NotmuchNotifier(metadata, orientation, panel_height, instance_id);
}
