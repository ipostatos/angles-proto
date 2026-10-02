import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.WatchUi;

// All holds as toggles, actions on top. Picks and progress are saved.
const FIRST_HOLD = 5;
const SYNC_ITEM = 4;

class HoldMenu extends WatchUi.Menu2 {
    function initialize(catalog as Array) {
        Menu2.initialize({:title => "Holds"});
        var picked = Storage.getValue("picked");
        if (!(picked instanceof Array)) {
            picked = [];
        }
        addItem(new WatchUi.MenuItem("BIG MODE", picked.size() + " selected", :big, null));
        addItem(new WatchUi.MenuItem("LIST", null, :list, null));
        addItem(new WatchUi.MenuItem("RESET PROGRESS", "clear cut marks", :reset, null));
        addItem(new WatchUi.MenuItem("RESET HOLDS", "untick all holds", :resetHolds, null));
        addItem(new WatchUi.MenuItem("FROM PHONE", "get holds sent from site", :sync, null));
        for (var i = 0; i < catalog.size(); i++) {
            var row = catalog[i] as Array;
            var name = row[0] as String;
            addItem(new WatchUi.ToggleMenuItem(name, null, row, picked.indexOf(name) >= 0, null));
        }
    }

    function onShow() as Void {
        Menu2.onShow();
        gHoldMenu = self;
    }

    function onHide() as Void {
        Menu2.onHide();
        if (gHoldMenu == self) {
            gHoldMenu = null;
        }
    }

    function setSyncStatus(text as String) as Void {
        getItem(SYNC_ITEM).setSubLabel(text);
        WatchUi.requestUpdate();
    }
}

class HoldMenuDelegate extends WatchUi.Menu2InputDelegate {
    hidden var _menu as HoldMenu;

    function initialize(menu as HoldMenu) {
        Menu2InputDelegate.initialize();
        _menu = menu;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :resetHolds) {
            Storage.setValue("picked", []);
            showHoldMenu();
            return;
        }
        if (id == :reset) {
            clearProgress();
            item.setSubLabel("cleared");
            WatchUi.requestUpdate();
            return;
        }
        if (id == :sync) {
            _menu.setSyncStatus("loading...");
            syncFromPhone();
            return;
        }
        if (id != :big && id != :list) {
            savePicked();
            return;
        }
        var rows = pickedRows();
        if (rows.size() == 0) {
            return;
        }
        var p = new Progress(rows);
        if (id == :big) {
            var v = new BigView(p);
            WatchUi.pushView(v, new BigDelegate(v, p), WatchUi.SLIDE_LEFT);
        } else {
            WatchUi.pushView(new AngleMenu(p), new AngleMenuDelegate(p), WatchUi.SLIDE_LEFT);
        }
    }

    hidden function pickedRows() as Array {
        var rows = [];
        for (var i = FIRST_HOLD; i < 1000; i++) {
            var it = _menu.getItem(i);
            if (it == null) {
                break;
            }
            if ((it as WatchUi.ToggleMenuItem).isEnabled()) {
                rows.add(it.getId());
            }
        }
        return rows;
    }

    hidden function savePicked() as Void {
        var rows = pickedRows();
        var names = [];
        for (var i = 0; i < rows.size(); i++) {
            names.add((rows[i] as Array)[0]);
        }
        Storage.setValue("picked", names);
        _menu.getItem(0).setSubLabel(names.size() + " selected");
        WatchUi.requestUpdate();
    }
}
