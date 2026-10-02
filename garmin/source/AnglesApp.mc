import Toybox.Application;
import Toybox.Application.Storage;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.WatchUi;

// Catalog row: [name, [main angles], [stefan angles]]
// Response: { h: catalog, s: [hold names sent from the web], t: sentAt seconds }
const CATALOG_URL = "https://avacut.vercel.app/api/watch";

// The hold menu currently on screen (null while angles are shown).
var gHoldMenu as HoldMenu or Null = null;

function loadCatalog() as Array {
    var cached = Storage.getValue("catalog");
    if (cached instanceof Array && cached.size() > 0) {
        return cached;
    }
    return WatchUi.loadResource(Rez.JsonData.Catalog) as Array;
}

function showHoldMenu() as Void {
    var menu = new HoldMenu(loadCatalog());
    WatchUi.switchToView(menu, new HoldMenuDelegate(menu), WatchUi.SLIDE_IMMEDIATE);
}

// Ask the server (through the phone) for the catalog and the "Send to watch" selection.
function syncFromPhone() as Void {
    Communications.makeWebRequest(CATALOG_URL, null, {
        :method => Communications.HTTP_REQUEST_METHOD_GET,
        :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
    }, new SyncHandler().method(:onResponse));
}

class SyncHandler {
    function initialize() {
    }

    function onResponse(code as Number, data as Dictionary or String or Null) as Void {
        if (code != 200 || !(data instanceof Dictionary)) {
            if (gHoldMenu != null) {
                gHoldMenu.setSyncStatus("no phone / offline");
            }
            return;
        }
        var holds = data["h"];
        if (holds instanceof Array && holds.size() > 0) {
            Storage.setValue("catalog", holds);
        }
        // A new send from the web replaces the picks and starts a fresh job.
        var sent = data["s"];
        var t = data["t"];
        var lastT = Storage.getValue("sentT");
        if (sent instanceof Array && t instanceof Number && t > 0 && (lastT == null || t != lastT)) {
            Storage.setValue("sentT", t);
            Storage.setValue("picked", sent);
            clearProgress();
        }
        if (gHoldMenu != null) {
            showHoldMenu();
        }
    }
}

class AnglesApp extends Application.AppBase {
    function initialize() {
        AppBase.initialize();
    }

    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        syncFromPhone();
        var menu = new HoldMenu(loadCatalog());
        return [menu, new HoldMenuDelegate(menu)];
    }
}
