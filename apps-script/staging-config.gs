/** Owner-run convenience for the two sheets explicitly supplied by the user.
 * Never fills production destinations, replaces configured values or creates
 * secrets. Configure remaining COPY IDs and tokens in Script Properties.
 */
function breadConfigureKnownStagingSheets() {
  var values = {
    BREAD_ENVIRONMENT: "staging",
    CRM_SPREADSHEET_ID: "1yt--g8XMWJxkkJMcodbbDxN_y7KVwgqdb3XmDbsEV_E",
    HQ_SPREADSHEET_ID: "1olxp1zTy14eaY1yfTuDhqsWP1FnktxShgVXQamErplY"
  };
  var props = PropertiesService.getScriptProperties();
  Object.keys(values).forEach(function (key) {
    var existing = props.getProperty(key);
    if (existing && existing !== values[key]) throw new Error("Refusing to overwrite " + key + "; review the existing configuration");
  });
  Object.keys(values).forEach(function (key) { props.setProperty(key, values[key]); });
  return { ok: true, configured: Object.keys(values), next: "Set remaining staging COPY IDs and tokens, then run breadHqSetup" };
}
