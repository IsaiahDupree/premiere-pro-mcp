/**
 * Data-artifact tests — verify that argument values are correctly embedded
 * in the generated ExtendScript for every tool that accepts parameters.
 *
 * Pattern:
 *   call handler({ ...args }) → inspect the script string passed to sendCommand
 *   → assert that each input value appears verbatim (or escaped) in the script.
 *
 * NOTE: JavaScript template literals drop trailing `.0` on integers written as
 * floats (e.g. `${5.0}` → "5"), so tests always use non-integer values like
 * 5.1, 3.3, 1.5 to prove the number actually lands in the script.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BridgeOptions } from "../../src/bridge/file-bridge.js";

vi.mock("../../src/bridge/file-bridge.js", () => ({
  sendCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  sendRawCommand: vi.fn().mockResolvedValue({ success: true, data: {} }),
  getTempDir: vi.fn().mockReturnValue("/tmp/test"),
  cleanupTempDir: vi.fn(),
}));

import { sendCommand } from "../../src/bridge/file-bridge.js";
const mockedSendCommand = vi.mocked(sendCommand);

import { getKeyframeTools } from "../../src/tools/keyframes.js";
import { getMediaTools } from "../../src/tools/media.js";
import { getTrackTools } from "../../src/tools/tracks.js";
import { getProjectTools } from "../../src/tools/project.js";
import { getExportTools } from "../../src/tools/export.js";
import { getAdvancedTools } from "../../src/tools/advanced.js";
import { getSequenceTools } from "../../src/tools/sequence.js";
import { getTimelineTools } from "../../src/tools/timeline.js";
import { getEffectsTools } from "../../src/tools/effects.js";
import { getAudioTools } from "../../src/tools/audio.js";
import { getMarkerTools } from "../../src/tools/markers.js";
import { getPlayheadTools } from "../../src/tools/playhead.js";
import { getTransitionsTools } from "../../src/tools/transitions.js";
import { getSelectionTools } from "../../src/tools/selection.js";
import { getSourceMonitorTools } from "../../src/tools/source-monitor.js";
import { getMetadataTools } from "../../src/tools/metadata.js";
import { getInspectionTools } from "../../src/tools/inspection.js";
import { getDiscoveryTools } from "../../src/tools/discovery.js";
import { getClipboardTools } from "../../src/tools/clipboard.js";
import { getTrackTargetingTools } from "../../src/tools/track-targeting.js";

const opts: BridgeOptions = { tempDir: "/tmp/artifact-test", timeoutMs: 5000 };

/** Call a handler and return the script string passed to sendCommand */
async function getScript(handler: (args: any) => Promise<any>, args: any): Promise<string> {
  vi.clearAllMocks();
  await handler(args);
  const calls = mockedSendCommand.mock.calls;
  if (calls.length === 0) throw new Error("sendCommand was never called");
  return calls[0][0] as string;
}

// ─── keyframes ────────────────────────────────────────────────────────────────

describe("keyframes data artifacts", () => {
  const tools = getKeyframeTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("add_keyframe embeds clip id, time, and value", async () => {
    const script = await getScript(tools.add_keyframe.handler, {
      node_id: "clip-abc",
      effect_name: "Motion",
      property_name: "Scale",
      time_seconds: 3.5,
      value: 75,
    });
    expect(script).toContain("clip-abc");
    expect(script).toContain("Motion");
    expect(script).toContain("Scale");
    expect(script).toContain("3.5");
    expect(script).toContain("75");
    expect(script).toContain("addKey");
    expect(script).toContain("setValueAtKey");
  });

  it("remove_keyframe embeds time", async () => {
    const script = await getScript(tools.remove_keyframe.handler, {
      node_id: "clip-xyz",
      effect_name: "Opacity",
      property_name: "Opacity",
      time_seconds: 7.25,
    });
    expect(script).toContain("7.25");
    expect(script).toContain("removeKey");
  });

  it("remove_keyframe_range embeds start and end", async () => {
    const script = await getScript(tools.remove_keyframe_range.handler, {
      node_id: "clip-123",
      effect_name: "Motion",
      property_name: "Position",
      start_seconds: 1.5,
      end_seconds: 4.5,
    });
    expect(script).toContain("1.5");
    expect(script).toContain("4.5");
    expect(script).toContain("removeKeyRange");
  });

  it("set_keyframe_interpolation embeds linear type code (0)", async () => {
    const script = await getScript(tools.set_keyframe_interpolation.handler, {
      node_id: "clip-kf",
      effect_name: "Opacity",
      property_name: "Opacity",
      time_seconds: 2.1,
      interpolation: "linear",
    });
    expect(script).toContain("setInterpolationTypeAtKey");
    expect(script).toContain(", 0,"); // linear = 0
  });

  it("set_keyframe_interpolation embeds hold type code (4)", async () => {
    const script = await getScript(tools.set_keyframe_interpolation.handler, {
      node_id: "clip-kf",
      effect_name: "Opacity",
      property_name: "Opacity",
      time_seconds: 2.1,
      interpolation: "hold",
    });
    expect(script).toContain(", 4,"); // hold = 4
  });

  it("set_keyframe_interpolation embeds bezier type code (5)", async () => {
    const script = await getScript(tools.set_keyframe_interpolation.handler, {
      node_id: "clip-kf",
      effect_name: "Opacity",
      property_name: "Opacity",
      time_seconds: 2.1,
      interpolation: "bezier",
    });
    expect(script).toContain(", 5,"); // bezier = 5
  });

  it("get_value_at_time embeds query time", async () => {
    const script = await getScript(tools.get_value_at_time.handler, {
      node_id: "clip-v",
      effect_name: "Motion",
      property_name: "Scale",
      time_seconds: 12.75,
    });
    expect(script).toContain("12.75");
    expect(script).toContain("getValueAtTime");
  });

  it("find_nearest_keyframe embeds time and default threshold (0.5)", async () => {
    const script = await getScript(tools.find_nearest_keyframe.handler, {
      node_id: "clip-n",
      effect_name: "Motion",
      property_name: "Scale",
      time_seconds: 5.1,
    });
    expect(script).toContain("5.1");
    expect(script).toContain("0.5"); // default threshold
    expect(script).toContain("findNearestKey");
  });

  it("find_nearest_keyframe uses custom threshold", async () => {
    const script = await getScript(tools.find_nearest_keyframe.handler, {
      node_id: "clip-n",
      effect_name: "Motion",
      property_name: "Scale",
      time_seconds: 5.1,
      threshold_seconds: 0.1,
    });
    expect(script).toContain("0.1");
  });

  it("find_next_keyframe embeds search time", async () => {
    const script = await getScript(tools.find_next_keyframe.handler, {
      node_id: "clip-next",
      effect_name: "Opacity",
      property_name: "Opacity",
      time_seconds: 3.3,
    });
    expect(script).toContain("3.3");
    expect(script).toContain("findNextKey");
  });

  it("find_previous_keyframe embeds search time", async () => {
    const script = await getScript(tools.find_previous_keyframe.handler, {
      node_id: "clip-prev",
      effect_name: "Opacity",
      property_name: "Opacity",
      time_seconds: 9.9,
    });
    expect(script).toContain("9.9");
    expect(script).toContain("findPreviousKey");
  });

  it("effect_name with double quotes is escaped", async () => {
    const script = await getScript(tools.add_keyframe.handler, {
      node_id: "clip-esc",
      effect_name: 'Lume"tri Color',
      property_name: "Exposure",
      time_seconds: 1.1,
      value: 0.5,
    });
    expect(script).toContain('\\"tri Color');
    expect(script).not.toMatch(/Lume"tri/);
  });
});

// ─── media ────────────────────────────────────────────────────────────────────

describe("media data artifacts", () => {
  const tools = getMediaTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("import_media embeds all file paths", async () => {
    const script = await getScript(tools.import_media.handler, {
      file_paths: ["/footage/a.mp4", "/footage/b.mov"],
    });
    expect(script).toContain("/footage/a.mp4");
    expect(script).toContain("/footage/b.mov");
    expect(script).toContain("importFiles");
  });

  it("import_media uses suppress_ui=true by default", async () => {
    const script = await getScript(tools.import_media.handler, {
      file_paths: ["/footage/c.mp4"],
    });
    expect(script).toContain("true");
  });

  it("import_media passes suppress_ui=false when specified", async () => {
    const script = await getScript(tools.import_media.handler, {
      file_paths: ["/footage/c.mp4"],
      suppress_ui: false,
    });
    expect(script).toContain("false");
  });

  it("import_media routes to target bin when given", async () => {
    const script = await getScript(tools.import_media.handler, {
      file_paths: ["/footage/d.mp4"],
      target_bin: "Raw Footage",
    });
    expect(script).toContain("Raw Footage");
    expect(script).toContain("__findProjectItem");
  });

  it("relink_media embeds item_id and new_path", async () => {
    const script = await getScript(tools.relink_media.handler, {
      item_id: "offline-clip",
      new_path: "/new/location/clip.mp4",
    });
    expect(script).toContain("offline-clip");
    expect(script).toContain("/new/location/clip.mp4");
    expect(script).toContain("changeMediaPath");
  });

  it("set_override_frame_rate embeds item and rate", async () => {
    const script = await getScript(tools.set_override_frame_rate.handler, {
      item_id: "img-seq",
      frame_rate: 23.976,
    });
    expect(script).toContain("img-seq");
    expect(script).toContain("23.976");
    expect(script).toContain("setOverrideFrameRate");
  });

  it("set_override_pixel_aspect_ratio embeds numerator and denominator", async () => {
    const script = await getScript(tools.set_override_pixel_aspect_ratio.handler, {
      item_id: "dv-clip",
      numerator: 10,
      denominator: 11,
    });
    expect(script).toContain("10");
    expect(script).toContain("11");
    expect(script).toContain("setOverridePixelAspectRatio");
  });

  it("set_start_time embeds seconds value", async () => {
    const script = await getScript(tools.set_start_time.handler, {
      item_id: "clip-st",
      start_seconds: 3600,
    });
    expect(script).toContain("3600");
    expect(script).toContain("setStartTime");
  });

  it("get_clip_source_in_out embeds item_id and calls both getters", async () => {
    const script = await getScript(tools.get_clip_source_in_out.handler, {
      item_id: "src-clip",
    });
    expect(script).toContain("src-clip");
    expect(script).toContain("getInPoint");
    expect(script).toContain("getOutPoint");
  });

  it("set_clip_source_in embeds in_seconds", async () => {
    const script = await getScript(tools.set_clip_source_in.handler, {
      item_id: "clip-in",
      in_seconds: 2.5,
    });
    expect(script).toContain("2.5");
    expect(script).toContain("setInPoint");
  });

  it("set_clip_source_out embeds out_seconds", async () => {
    const script = await getScript(tools.set_clip_source_out.handler, {
      item_id: "clip-out",
      out_seconds: 15.5,
    });
    expect(script).toContain("15.5");
    expect(script).toContain("setOutPoint");
  });

  it("clear_clip_source_in calls clearInPoint", async () => {
    const script = await getScript(tools.clear_clip_source_in.handler, {
      item_id: "clip-clr",
    });
    expect(script).toContain("clip-clr");
    expect(script).toContain("clearInPoint");
  });

  it("clear_clip_source_out calls clearOutPoint", async () => {
    const script = await getScript(tools.clear_clip_source_out.handler, {
      item_id: "clip-clr",
    });
    expect(script).toContain("clearOutPoint");
  });

  it("get_item_color_space calls getOriginalColorSpace", async () => {
    const script = await getScript(tools.get_item_color_space.handler, {
      item_id: "hdr-clip",
    });
    expect(script).toContain("hdr-clip");
    expect(script).toContain("getOriginalColorSpace");
  });

  it("get_item_lut_ids calls both LUT getters", async () => {
    const script = await getScript(tools.get_item_lut_ids.handler, {
      item_id: "log-clip",
    });
    expect(script).toContain("getEmbeddedLUTID");
    expect(script).toContain("getInputLUTID");
  });

  it("create_bin embeds name and optional parent", async () => {
    const script = await getScript(tools.create_bin.handler, {
      name: "Interview Footage",
      parent_bin: "Dailies",
    });
    expect(script).toContain("Interview Footage");
    expect(script).toContain("Dailies");
    expect(script).toContain("createBin");
  });

  it("move_item_to_bin embeds both IDs", async () => {
    const script = await getScript(tools.move_item_to_bin.handler, {
      item_id: "clip-move",
      target_bin: "Archive",
    });
    expect(script).toContain("clip-move");
    expect(script).toContain("Archive");
    expect(script).toContain("moveBin");
  });
});

// ─── tracks ───────────────────────────────────────────────────────────────────

describe("tracks data artifacts", () => {
  const tools = getTrackTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("add_track video uses insertVideoTrackAt", async () => {
    const script = await getScript(tools.add_track.handler, { track_type: "video" });
    expect(script).toContain("videoTracks");
    expect(script).toContain("insertVideoTrackAt");
  });

  it("add_track audio uses insertAudioTrackAt", async () => {
    const script = await getScript(tools.add_track.handler, { track_type: "audio" });
    expect(script).toContain("audioTracks");
    expect(script).toContain("insertAudioTrackAt");
  });

  it("delete_track embeds track index", async () => {
    const script = await getScript(tools.delete_track.handler, {
      track_type: "video",
      track_index: 2,
    });
    expect(script).toContain("2");
    expect(script).toContain("deleteVideoTrackAt");
  });

  it("lock_track embeds locked=true as 1", async () => {
    const script = await getScript(tools.lock_track.handler, {
      track_index: 1,
      locked: true,
    });
    expect(script).toContain("setLocked(1)");
  });

  it("lock_track embeds locked=false as 0", async () => {
    const script = await getScript(tools.lock_track.handler, {
      track_index: 0,
      locked: false,
    });
    expect(script).toContain("setLocked(0)");
  });

  it("toggle_track_visibility visible=false sets mute=1", async () => {
    const script = await getScript(tools.toggle_track_visibility.handler, {
      track_index: 0,
      visible: false,
    });
    expect(script).toContain("setMute(1)");
  });

  it("toggle_track_visibility visible=true sets mute=0", async () => {
    const script = await getScript(tools.toggle_track_visibility.handler, {
      track_index: 0,
      visible: true,
    });
    expect(script).toContain("setMute(0)");
  });

  it("get_track_mute embeds video track lookup", async () => {
    const script = await getScript(tools.get_track_mute.handler, {
      track_type: "video",
      track_index: 3,
    });
    expect(script).toContain("videoTracks");
    expect(script).toContain("3");
    expect(script).toContain("isMuted");
  });

  it("get_track_mute embeds audio track lookup", async () => {
    const script = await getScript(tools.get_track_mute.handler, {
      track_type: "audio",
      track_index: 1,
    });
    expect(script).toContain("audioTracks");
    expect(script).toContain("isMuted");
  });

  it("remove_tracks_qe embeds all four indices", async () => {
    const script = await getScript(tools.remove_tracks_qe.handler, {
      video_track_index: 2,
      audio_track_index: 1,
      audio_mono_track_index: 0,
      audio_51_track_index: -1,
    });
    expect(script).toContain("removeTracks");
    expect(script).toContain("qe.project.getActiveSequence");
  });

  it("remove_tracks_qe defaults mono and 5.1 to -1", async () => {
    const script = await getScript(tools.remove_tracks_qe.handler, {
      video_track_index: 0,
      audio_track_index: 0,
    });
    expect(script).toContain("removeTracks(0, 0, -1, -1)");
  });
});

// ─── project ──────────────────────────────────────────────────────────────────

describe("project data artifacts", () => {
  const tools = getProjectTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("save_project_as embeds path", async () => {
    const script = await getScript(tools.save_project_as.handler, {
      path: "/Users/me/MyProject.prproj",
    });
    expect(script).toContain("/Users/me/MyProject.prproj");
    expect(script).toContain("saveAs");
  });

  it("open_project embeds path", async () => {
    const script = await getScript(tools.open_project.handler, {
      path: "/Users/me/Existing.prproj",
    });
    expect(script).toContain("/Users/me/Existing.prproj");
    expect(script).toContain("openDocument");
  });

  it("create_project embeds path", async () => {
    const script = await getScript(tools.create_project.handler, {
      path: "/Users/me/New.prproj",
    });
    expect(script).toContain("/Users/me/New.prproj");
    expect(script).toContain("newProject");
  });

  it("close_project with save_first=true passes 1", async () => {
    const script = await getScript(tools.close_project.handler, { save_first: true });
    expect(script).toContain("closeDocument(1");
  });

  it("close_project with save_first=false passes 0", async () => {
    const script = await getScript(tools.close_project.handler, { save_first: false });
    expect(script).toContain("closeDocument(0");
  });

  it("set_active_sequence embeds sequence_id", async () => {
    const script = await getScript(tools.set_active_sequence.handler, {
      sequence_id: "my-sequence",
    });
    expect(script).toContain("my-sequence");
    expect(script).toContain("__findSequence");
  });

  it("undo embeds count", async () => {
    const script = await getScript(tools.undo.handler, { count: 5 });
    expect(script).toContain("5");
    expect(script).toContain("undo()");
  });

  it("undo defaults to 1", async () => {
    const script = await getScript(tools.undo.handler, {});
    expect(script).toContain("< 1;");
  });

  it("find_items_by_media_path embeds search string", async () => {
    const script = await getScript(tools.find_items_by_media_path.handler, {
      path_search: "/footage/interview",
    });
    expect(script).toContain("/footage/interview");
    expect(script).toContain("findItemsMatchingMediaPath");
  });

  it("set_scratch_disk_path embeds type and path", async () => {
    const script = await getScript(tools.set_scratch_disk_path.handler, {
      scratch_disk_type: "videoPreview",
      path: "/Volumes/SSD/previews",
    });
    expect(script).toContain("videoPreview");
    expect(script).toContain("/Volumes/SSD/previews");
    expect(script).toContain("setScratchDiskPath");
  });

  it("import_ae_comps with comp names embeds them", async () => {
    const script = await getScript(tools.import_ae_comps.handler, {
      ae_project_path: "/projects/motion.aep",
      comp_names: ["Logo Animation", "Lower Third"],
    });
    expect(script).toContain("Logo Animation");
    expect(script).toContain("Lower Third");
    expect(script).toContain("importAEComps");
  });

  it("import_ae_comps without comp names uses importAllAEComps", async () => {
    const script = await getScript(tools.import_ae_comps.handler, {
      ae_project_path: "/projects/motion.aep",
    });
    expect(script).toContain("importAllAEComps");
  });

  it("add_custom_metadata_field embeds name, label, and type", async () => {
    const script = await getScript(tools.add_custom_metadata_field.handler, {
      field_name: "shootDate",
      field_label: "Shoot Date",
      field_type: 2,
    });
    expect(script).toContain("shootDate");
    expect(script).toContain("Shoot Date");
    expect(script).toContain("2");
    expect(script).toContain("addPropertyToProjectMetadataSchema");
  });

  it("get_project_view_ids calls getProjectViewIDs", async () => {
    const script = await getScript(tools.get_project_view_ids.handler, {});
    expect(script).toContain("getProjectViewIDs");
  });

  it("get_current_project_view_selection calls getCurrentProjectViewSelection", async () => {
    const script = await getScript(tools.get_current_project_view_selection.handler, {});
    expect(script).toContain("getCurrentProjectViewSelection");
  });

  it("get_enable_proxies calls getEnableProxies", async () => {
    const script = await getScript(tools.get_enable_proxies.handler, {});
    expect(script).toContain("getEnableProxies");
  });

  it("get_app_property embeds key and uses getString", async () => {
    const script = await getScript(tools.get_app_property.handler, {
      key: "myPlugin.setting",
    });
    expect(script).toContain("myPlugin.setting");
    expect(script).toContain("app.properties");
    expect(script).toContain("getString");
  });

  it("set_app_property embeds key and value with setString", async () => {
    const script = await getScript(tools.set_app_property.handler, {
      key: "myPlugin.color",
      value: "#FF5500",
    });
    expect(script).toContain("myPlugin.color");
    expect(script).toContain("#FF5500");
    expect(script).toContain("setString");
  });
});

// ─── export ───────────────────────────────────────────────────────────────────

describe("export data artifacts", () => {
  const tools = getExportTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("export_sequence embeds output path and uses exportAsMediaDirect", async () => {
    const script = await getScript(tools.export_sequence.handler, {
      output_path: "/renders/final.mp4",
    });
    expect(script).toContain("/renders/final.mp4");
    expect(script).toContain("exportAsMediaDirect");
  });

  it("export_sequence embeds preset path when provided", async () => {
    const script = await getScript(tools.export_sequence.handler, {
      output_path: "/renders/out.mp4",
      preset_path: "/presets/H264-HD.epr",
    });
    expect(script).toContain("/presets/H264-HD.epr");
  });

  it("export_sequence work_area_only uses ENCODE_WORKAREA", async () => {
    const script = await getScript(tools.export_sequence.handler, {
      output_path: "/renders/workarea.mp4",
      work_area_only: true,
    });
    expect(script).toContain("ENCODE_WORKAREA");
  });

  it("export_sequence without work_area uses ENCODE_ENTIRE", async () => {
    const script = await getScript(tools.export_sequence.handler, {
      output_path: "/renders/full.mp4",
    });
    expect(script).toContain("ENCODE_ENTIRE");
  });

  it("export_frame embeds output path and time", async () => {
    const script = await getScript(tools.export_frame.handler, {
      output_path: "/frames/frame.png",
      time_seconds: 5.5,
    });
    expect(script).toContain("/frames/frame.png");
    expect(script).toContain("5.5");
  });

  it("export_as_fcp_xml embeds output path", async () => {
    const script = await getScript(tools.export_as_fcp_xml.handler, {
      output_path: "/xml/timeline.xml",
    });
    expect(script).toContain("/xml/timeline.xml");
    expect(script).toContain("exportAsFinalCutProXML");
  });

  it("export_aaf embeds output path", async () => {
    const script = await getScript(tools.export_aaf.handler, {
      output_path: "/audio/export.aaf",
    });
    expect(script).toContain("/audio/export.aaf");
    expect(script).toContain("exportAsAAF");
  });

  it("encode_project_item embeds item_id and paths", async () => {
    const script = await getScript(tools.encode_project_item.handler, {
      item_id: "prores-clip",
      output_path: "/out/encoded.mp4",
      preset_path: "/presets/H264.epr",
    });
    expect(script).toContain("prores-clip");
    expect(script).toContain("/out/encoded.mp4");
    expect(script).toContain("/presets/H264.epr");
    expect(script).toContain("encodeProjectItem");
  });

  it("encode_file embeds input and output paths", async () => {
    const script = await getScript(tools.encode_file.handler, {
      input_path: "/raw/footage.mov",
      output_path: "/out/compressed.mp4",
      preset_path: "/presets/Web.epr",
    });
    expect(script).toContain("/raw/footage.mov");
    expect(script).toContain("/out/compressed.mp4");
    expect(script).toContain("encodeFile");
  });

  it("encode_file embeds in/out points when provided", async () => {
    const script = await getScript(tools.encode_file.handler, {
      input_path: "/raw/long.mov",
      output_path: "/out/trim.mp4",
      preset_path: "/p.epr",
      in_seconds: 10.5,
      out_seconds: 30.5,
    });
    expect(script).toContain("10.5");
    expect(script).toContain("30.5");
  });

  it("set_encoder_xmp_enabled embeds enabled=1 and sidecar=0", async () => {
    const script = await getScript(tools.set_encoder_xmp_enabled.handler, {
      embedded: true,
      sidecar: false,
    });
    expect(script).toContain("setEmbeddedXMPEnabled(1)");
    expect(script).toContain("setSidecarXMPEnabled(0)");
  });

  it("set_encoder_xmp_enabled enables sidecar when set", async () => {
    const script = await getScript(tools.set_encoder_xmp_enabled.handler, {
      embedded: false,
      sidecar: true,
    });
    expect(script).toContain("setEmbeddedXMPEnabled(0)");
    expect(script).toContain("setSidecarXMPEnabled(1)");
  });
});

// ─── advanced ─────────────────────────────────────────────────────────────────

describe("advanced data artifacts", () => {
  const tools = getAdvancedTools(opts);
  const trackTargetingTools = getTrackTargetingTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("ripple_delete embeds node_id and uses QE DOM", async () => {
    const script = await getScript(tools.ripple_delete.handler, { node_id: "clip-rd" });
    expect(script).toContain("clip-rd");
    expect(script).toContain("enableQE");
    expect(script).toContain("rippleDelete");
  });

  it("set_clip_speed_qe embeds node_id and speed_percent", async () => {
    const script = await getScript(tools.set_clip_speed_qe.handler, {
      node_id: "clip-spd",
      speed_percent: 150,
    });
    expect(script).toContain("clip-spd");
    expect(script).toContain("150");
  });

  it("roll_edit embeds node_id and offset_seconds", async () => {
    const script = await getScript(tools.roll_edit.handler, {
      node_id: "clip-roll",
      offset_seconds: -0.5,
    });
    expect(script).toContain("clip-roll");
    expect(script).toContain("-0.5");
    expect(script).toContain("roll");
  });

  it("slip_edit embeds node_id and offset_seconds", async () => {
    const script = await getScript(tools.slip_edit.handler, {
      node_id: "clip-slip",
      offset_seconds: 1.5,
    });
    expect(script).toContain("clip-slip");
    expect(script).toContain("1.5");
    expect(script).toContain("slip");
  });

  it("move_clip_qe embeds node_id and new time", async () => {
    const script = await getScript(tools.move_clip_qe.handler, {
      node_id: "clip-mv",
      new_time_seconds: 8.3,
    });
    expect(script).toContain("clip-mv");
    expect(script).toContain("8.3");
    expect(script).toContain("move");
    expect(script).toContain("enableQE");
  });

  it("overwrite_clip embeds item_id, track, and start time", async () => {
    const script = await getScript(tools.overwrite_clip.handler, {
      item_id: "clip-ow",
      start_seconds: 5.3,
      track_index: 2,
    });
    expect(script).toContain("clip-ow");
    expect(script).toContain("5.3");
    expect(script).toContain("overwriteClip");
  });

  it("add_tracks embeds video and audio counts", async () => {
    const script = await getScript(tools.add_tracks.handler, {
      video_tracks: 2,
      audio_tracks: 3,
    });
    expect(script).toContain("addTracks(2, 3");
    expect(script).toContain("qe.project.getActiveSequence");
  });

  it("set_color_value embeds ARGB components", async () => {
    const script = await getScript(tools.set_color_value.handler, {
      node_id: "clip-col",
      component_name: "Fill",
      property_name: "Color",
      alpha: 255,
      red: 128,
      green: 64,
      blue: 32,
    });
    expect(script).toContain("255");
    expect(script).toContain("128");
    expect(script).toContain("64");
    expect(script).toContain("32");
    expect(script).toContain("setColorValue");
  });

  it("set_zero_point embeds start_seconds", async () => {
    const script = await getScript(tools.set_zero_point.handler, {
      start_seconds: 3600,
    });
    expect(script).toContain("3600");
    expect(script).toContain("setZeroPoint");
  });

  it("set_clip_scale embeds scale value", async () => {
    const script = await getScript(trackTargetingTools.set_clip_scale.handler, {
      node_id: "clip-sc",
      scale: 150,
    });
    expect(script).toContain("clip-sc");
    expect(script).toContain("150");
    expect(script).toContain("Scale");
  });

  it("set_clip_opacity embeds opacity value", async () => {
    const script = await getScript(trackTargetingTools.set_clip_opacity.handler, {
      node_id: "clip-op",
      opacity: 80,
    });
    expect(script).toContain("clip-op");
    expect(script).toContain("80");
    expect(script).toContain("Opacity");
  });

  it("set_clip_rotation embeds rotation value", async () => {
    const script = await getScript(trackTargetingTools.set_clip_rotation.handler, {
      node_id: "clip-rot",
      degrees: 45,
    });
    expect(script).toContain("clip-rot");
    expect(script).toContain("45");
    expect(script).toContain("Rotation");
  });

  it("set_clip_position embeds x and y", async () => {
    const script = await getScript(trackTargetingTools.set_clip_position.handler, {
      node_id: "clip-pos",
      x: 960,
      y: 540,
    });
    expect(script).toContain("960");
    expect(script).toContain("540");
    expect(script).toContain("Position");
  });

  it("batch_rename_clips embeds pattern", async () => {
    const script = await getScript(trackTargetingTools.batch_rename_clips.handler, {
      pattern: "Scene_{n}",
      track_type: "video",
      track_index: 0,
    });
    expect(script).toContain("Scene_{n}");
  });

  it("batch_enable_disable embeds enabled flag", async () => {
    const script = await getScript(trackTargetingTools.batch_enable_disable.handler, {
      enabled: false,
      target: "all",
    });
    expect(script).toContain("false");
  });
});

// ─── sequence ─────────────────────────────────────────────────────────────────

describe("sequence data artifacts", () => {
  const tools = getSequenceTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("create_sequence embeds name", async () => {
    const script = await getScript(tools.create_sequence.handler, {
      name: "Main Timeline",
    });
    expect(script).toContain("Main Timeline");
    expect(script).toContain("createNewSequence");
  });

  it("create_sequence uses preset path when provided", async () => {
    const script = await getScript(tools.create_sequence.handler, {
      name: "4K Sequence",
      preset_path: "/presets/UHD.sqpreset",
    });
    expect(script).toContain("4K Sequence");
    expect(script).toContain("/presets/UHD.sqpreset");
    expect(script).toContain("createNewSequenceFromPreset");
  });

  it("create_sequence_from_preset embeds both name and preset_path", async () => {
    const script = await getScript(tools.create_sequence_from_preset.handler, {
      name: "Reel Sequence",
      preset_path: "/presets/1080p30.sqpreset",
    });
    expect(script).toContain("Reel Sequence");
    expect(script).toContain("/presets/1080p30.sqpreset");
    expect(script).toContain("createNewSequenceFromPreset");
  });

  it("delete_sequence embeds sequence_id", async () => {
    const script = await getScript(tools.delete_sequence.handler, {
      sequence_id: "seq-del",
    });
    expect(script).toContain("seq-del");
    expect(script).toContain("deleteSequence");
  });

  it("duplicate_sequence embeds source sequence_id", async () => {
    const script = await getScript(tools.duplicate_sequence.handler, {
      sequence_id: "original",
    });
    expect(script).toContain("original");
  });

  it("get_sequence_analysis_status calls isDoneAnalyzingForVideoEffects", async () => {
    const script = await getScript(tools.get_sequence_analysis_status.handler, {});
    expect(script).toContain("isDoneAnalyzingForVideoEffects");
    expect(script).toContain("analysisDone");
  });

  it("attach_custom_property embeds id and value", async () => {
    const script = await getScript(tools.attach_custom_property.handler, {
      property_id: "com.myapp.version",
      property_value: "2.0",
    });
    expect(script).toContain("com.myapp.version");
    expect(script).toContain("2.0");
    expect(script).toContain("attachCustomProperty");
  });
});

// ─── timeline ─────────────────────────────────────────────────────────────────

describe("timeline data artifacts", () => {
  const tools = getTimelineTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("add_to_timeline embeds item_id and time", async () => {
    const script = await getScript(tools.add_to_timeline.handler, {
      item_id: "b-roll",
      start_seconds: 10.5,
      track_index: 1,
    });
    expect(script).toContain("b-roll");
    expect(script).toContain("10.5");
  });

  it("remove_from_timeline embeds node_id", async () => {
    const script = await getScript(tools.remove_from_timeline.handler, {
      node_id: "clip-rm",
    });
    expect(script).toContain("clip-rm");
    expect(script).toContain("remove");
  });

  it("trim_clip embeds node_id and non-integer seconds", async () => {
    const script = await getScript(tools.trim_clip.handler, {
      node_id: "clip-tr",
      new_in_seconds: 1.5,
      new_out_seconds: 5.5,
    });
    expect(script).toContain("clip-tr");
    expect(script).toContain("1.5");
    expect(script).toContain("5.5");
  });

  it("split_clip embeds time", async () => {
    const script = await getScript(tools.split_clip.handler, {
      time_seconds: 3.5,
    });
    expect(script).toContain("3.5");
  });

  it("move_clip embeds node_id and target time", async () => {
    const script = await getScript(tools.move_clip.handler, {
      node_id: "clip-mc",
      new_start_seconds: 7.5,
    });
    expect(script).toContain("clip-mc");
    expect(script).toContain("7.5");
  });

  it("speed_change embeds node_id and speed", async () => {
    const script = await getScript(tools.speed_change.handler, {
      node_id: "clip-speed",
      speed_percent: 200,
    });
    expect(script).toContain("clip-speed");
    expect(script).toContain("200");
  });
});

// ─── effects ──────────────────────────────────────────────────────────────────

describe("effects data artifacts", () => {
  const tools = getEffectsTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("apply_effect embeds node_id and effect name", async () => {
    const script = await getScript(tools.apply_effect.handler, {
      node_id: "clip-fx",
      effect_name: "Gaussian Blur",
    });
    expect(script).toContain("clip-fx");
    expect(script).toContain("Gaussian Blur");
  });

  it("remove_effect embeds node_id and effect name", async () => {
    const script = await getScript(tools.remove_effect.handler, {
      node_id: "clip-fx",
      effect_name: "Sharpen",
    });
    expect(script).toContain("Sharpen");
  });

  it("apply_lut embeds node_id and lut_path", async () => {
    const script = await getScript(tools.apply_lut.handler, {
      node_id: "clip-lut",
      lut_path: "/luts/film.cube",
    });
    expect(script).toContain("clip-lut");
    expect(script).toContain("/luts/film.cube");
  });

  it("color_correct embeds all numeric adjustments", async () => {
    const script = await getScript(tools.color_correct.handler, {
      node_id: "clip-cc",
      exposure: 0.5,
      contrast: -10,
      highlights: 20,
      shadows: -5,
      saturation: 110,
    });
    expect(script).toContain("0.5");
    expect(script).toContain("-10");
    expect(script).toContain("20");
    expect(script).toContain("-5");
    expect(script).toContain("110");
    expect(script).toContain("Lumetri");
  });

  it("stabilize_clip embeds node_id", async () => {
    const script = await getScript(tools.stabilize_clip.handler, {
      node_id: "shaky-clip",
    });
    expect(script).toContain("shaky-clip");
  });
});

// ─── audio ────────────────────────────────────────────────────────────────────

describe("audio data artifacts", () => {
  const tools = getAudioTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("adjust_audio_levels embeds node_id and dB value", async () => {
    const script = await getScript(tools.adjust_audio_levels.handler, {
      node_id: "audio-clip",
      level_db: -6.5,
    });
    expect(script).toContain("audio-clip");
    expect(script).toContain("-6.5");
  });

  it("add_audio_keyframes embeds node_id and keyframe data", async () => {
    const script = await getScript(tools.add_audio_keyframes.handler, {
      node_id: "audio-kf",
      keyframes: [
        { time_seconds: 2.5, level_db: -3.5 },
        { time_seconds: 5.5, level_db: -12.5 },
      ],
    });
    expect(script).toContain("audio-kf");
    expect(script).toContain("2.5");
    expect(script).toContain("-3.5");
    expect(script).toContain("5.5");
    expect(script).toContain("-12.5");
  });

  it("mute_track embeds track index", async () => {
    const script = await getScript(tools.mute_track.handler, {
      track_index: 2,
      muted: true,
    });
    expect(script).toContain("2");
  });
});

// ─── markers ──────────────────────────────────────────────────────────────────

describe("markers data artifacts", () => {
  const tools = getMarkerTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("add_marker embeds time, name, and comment", async () => {
    const script = await getScript(tools.add_marker.handler, {
      time_seconds: 12.5,
      name: "Scene Start",
      comments: "Intro scene",
    });
    expect(script).toContain("12.5");
    expect(script).toContain("Scene Start");
    expect(script).toContain("Intro scene");
    expect(script).toContain("createMarker");
  });

  it("delete_marker embeds marker time", async () => {
    const script = await getScript(tools.delete_marker.handler, {
      time_seconds: 12.5,
    });
    expect(script).toContain("12.5");
    expect(script).toContain("deleteMarker");
  });

  it("update_marker embeds time and new values", async () => {
    const script = await getScript(tools.update_marker.handler, {
      time_seconds: 5.5,
      name: "Updated Name",
      comments: "Updated comment",
    });
    expect(script).toContain("5.5");
    expect(script).toContain("Updated Name");
    expect(script).toContain("Updated comment");
  });
});

// ─── playhead ─────────────────────────────────────────────────────────────────

describe("playhead data artifacts", () => {
  const tools = getPlayheadTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("set_playhead_position embeds time", async () => {
    const script = await getScript(tools.set_playhead_position.handler, {
      time_seconds: 30.5,
    });
    expect(script).toContain("30.5");
    expect(script).toContain("setPlayerPosition");
  });

  it("set_sequence_in_out_points embeds in time", async () => {
    const script = await getScript(tools.set_sequence_in_out_points.handler, {
      in_seconds: 5.5,
      out_seconds: 25.5,
    });
    expect(script).toContain("5.5");
    expect(script).toContain("setInPoint");
  });

  it("set_sequence_in_out_points embeds out time", async () => {
    const script = await getScript(tools.set_sequence_in_out_points.handler, {
      in_seconds: 5.5,
      out_seconds: 25.5,
    });
    expect(script).toContain("25.5");
    expect(script).toContain("setOutPoint");
  });
});

// ─── transitions ──────────────────────────────────────────────────────────────

describe("transitions data artifacts", () => {
  const tools = getTransitionsTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("add_transition_to_clip embeds node_id, name, and duration", async () => {
    const script = await getScript(tools.add_transition_to_clip.handler, {
      node_id: "clip-trans",
      transition_name: "Cross Dissolve",
      duration_seconds: 1.5,
    });
    expect(script).toContain("clip-trans");
    expect(script).toContain("Cross Dissolve");
    expect(script).toContain("1.5");
  });

  it("add_transition embeds transition name and cut point", async () => {
    const script = await getScript(tools.add_transition.handler, {
      transition_name: "Dip to Black",
      track_index: 0,
      cut_point_seconds: 5.5,
    });
    expect(script).toContain("Dip to Black");
    expect(script).toContain("5.5");
  });
});

// ─── selection ────────────────────────────────────────────────────────────────

describe("selection data artifacts", () => {
  const tools = getSelectionTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("select_clips_in_range embeds time range", async () => {
    const script = await getScript(tools.select_clips_in_range.handler, {
      start_seconds: 5.5,
      end_seconds: 15.5,
    });
    expect(script).toContain("5.5");
    expect(script).toContain("15.5");
  });

  it("select_clips_by_name embeds name pattern", async () => {
    const script = await getScript(tools.select_clips_by_name.handler, {
      name: "interview",
    });
    expect(script).toContain("interview");
  });

  it("select_clips_by_color embeds label index", async () => {
    const script = await getScript(tools.select_clips_by_color.handler, {
      label_index: 3,
    });
    expect(script).toContain("3");
  });
});

// ─── source-monitor ───────────────────────────────────────────────────────────

describe("source-monitor data artifacts", () => {
  const tools = getSourceMonitorTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("open_in_source embeds item_id", async () => {
    const script = await getScript(tools.open_in_source.handler, {
      item_id: "source-clip",
    });
    expect(script).toContain("source-clip");
    expect(script).toContain("sourceMonitor");
  });

  it("set_source_in_out embeds in and out times", async () => {
    const script = await getScript(tools.set_source_in_out.handler, {
      in_seconds: 3.5,
      out_seconds: 8.5,
    });
    expect(script).toContain("3.5");
    expect(script).toContain("8.5");
  });

  it("insert_from_source embeds track indices", async () => {
    const script = await getScript(tools.insert_from_source.handler, {
      video_track_index: 0,
      audio_track_index: 0,
    });
    expect(script).toContain("insertClip");
  });

  it("overwrite_from_source embeds track indices", async () => {
    const script = await getScript(tools.overwrite_from_source.handler, {
      video_track_index: 1,
      audio_track_index: 1,
    });
    expect(script).toContain("overwriteClip");
  });
});

// ─── metadata ─────────────────────────────────────────────────────────────────

describe("metadata data artifacts", () => {
  const tools = getMetadataTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("set_metadata embeds item_id and key/value", async () => {
    const script = await getScript(tools.set_metadata.handler, {
      item_id: "meta-clip",
      field_name: "xmpDM:scene",
      value: "Scene 01",
    });
    expect(script).toContain("meta-clip");
    expect(script).toContain("xmpDM:scene");
    expect(script).toContain("Scene 01");
  });

  it("set_color_label embeds item_id and label index", async () => {
    const script = await getScript(tools.set_color_label.handler, {
      item_id: "label-clip",
      label_index: 3,
    });
    expect(script).toContain("label-clip");
    expect(script).toContain("3");
    expect(script).toContain("setColorLabel");
  });

  it("set_xmp_metadata embeds item_id and xmp_xml content", async () => {
    const script = await getScript(tools.set_xmp_metadata.handler, {
      item_id: "xmp-clip",
      xmp_xml: "<x:xmpmeta><rdf:Rating>5</rdf:Rating></x:xmpmeta>",
    });
    expect(script).toContain("xmp-clip");
    expect(script).toContain("rdf:Rating");
  });
});

// ─── inspection ───────────────────────────────────────────────────────────────

describe("inspection data artifacts", () => {
  const tools = getInspectionTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("get_timeline_gaps embeds sequence_id when provided", async () => {
    const script = await getScript(tools.get_timeline_gaps.handler, {
      sequence_id: "my-seq",
    });
    expect(script).toContain("my-seq");
  });

  it("get_used_media_report uses root item traversal", async () => {
    const script = await getScript(tools.get_used_media_report.handler, {});
    expect(script).toContain("rootItem");
  });
});

// ─── discovery ────────────────────────────────────────────────────────────────

describe("discovery data artifacts", () => {
  const tools = getDiscoveryTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("get_clip_properties embeds node_id", async () => {
    const script = await getScript(tools.get_clip_properties.handler, {
      node_id: "node-42",
    });
    expect(script).toContain("node-42");
    expect(script).toContain("__findClip");
  });

  it("get_clip_at_position embeds time and track index", async () => {
    const script = await getScript(tools.get_clip_at_position.handler, {
      time_seconds: 7.5,
      track_index: 2,
      track_type: "video",
    });
    expect(script).toContain("7.5");
    expect(script).toContain("videoTracks");
    expect(script).toContain("2");
  });

  it("list_sequence_tracks with sequence_id embeds it", async () => {
    const script = await getScript(tools.list_sequence_tracks.handler, {
      sequence_id: "timeline-1",
    });
    expect(script).toContain("timeline-1");
  });

  it("list_project_items with bin_path embeds it", async () => {
    const script = await getScript(tools.list_project_items.handler, {
      bin_path: "Footage/Raw",
    });
    expect(script).toContain("Footage/Raw");
  });
});

// ─── clipboard ────────────────────────────────────────────────────────────────

describe("clipboard data artifacts", () => {
  const tools = getClipboardTools(opts);

  beforeEach(() => vi.clearAllMocks());

  it("copy_effects_between_clips embeds source and target node_ids", async () => {
    const script = await getScript(tools.copy_effects_between_clips.handler, {
      source_node_id: "src-fx-clip",
      target_node_id: "dst-fx-clip",
    });
    expect(script).toContain("src-fx-clip");
    expect(script).toContain("dst-fx-clip");
  });

  it("replace_clip_media embeds clip_node_id and new_item_id", async () => {
    const script = await getScript(tools.replace_clip_media.handler, {
      clip_node_id: "timeline-clip",
      new_item_id: "new-item",
    });
    expect(script).toContain("timeline-clip");
    expect(script).toContain("new-item");
  });

  it("set_blend_mode embeds node_id and blend mode name", async () => {
    const script = await getScript(tools.set_blend_mode.handler, {
      node_id: "clip-bm",
      blend_mode: "Screen",
    });
    expect(script).toContain("clip-bm");
    expect(script).toContain("Screen");
  });
});

// ─── Special escaping edge cases ──────────────────────────────────────────────

describe("special character escaping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("paths with spaces pass through correctly", async () => {
    const tools = getMediaTools(opts);
    const script = await getScript(tools.import_media.handler, {
      file_paths: ["/Users/John Doe/My Footage/clip.mp4"],
    });
    expect(script).toContain("John Doe");
    expect(script).toContain("My Footage");
  });

  it("double quotes in effect names are escaped", async () => {
    const tools = getKeyframeTools(opts);
    const script = await getScript(tools.get_effect_properties.handler, {
      node_id: "clip-q",
      effect_name: 'He said "blur"',
    });
    expect(script).toContain('\\"blur\\"');
    expect(script).not.toMatch(/He said "blur"/);
  });

  it("Windows-style paths with backslashes are embedded", async () => {
    const tools = getProjectTools(opts);
    const script = await getScript(tools.open_project.handler, {
      path: "C:\\Users\\Editor\\Project.prproj",
    });
    expect(script).toContain("Project.prproj");
  });

  it("unicode characters pass through in sequence names", async () => {
    const tools = getProjectTools(opts);
    const script = await getScript(tools.set_active_sequence.handler, {
      sequence_id: "Séquence Principale",
    });
    expect(script).toContain("Séquence Principale");
  });

  it("empty string arguments don't crash script generation", async () => {
    const tools = getEffectsTools(opts);
    await (tools.apply_effect.handler as any)({ node_id: "c", effect_name: "" });
    expect(mockedSendCommand).toHaveBeenCalled();
  });
});

// ─── Numeric precision ────────────────────────────────────────────────────────

describe("numeric precision in scripts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sub-millisecond time values are preserved", async () => {
    const tools = getKeyframeTools(opts);
    const script = await getScript(tools.add_keyframe.handler, {
      node_id: "clip-p",
      effect_name: "Motion",
      property_name: "Scale",
      time_seconds: 1.001,
      value: 100,
    });
    expect(script).toContain("1.001");
  });

  it("negative time offsets pass through", async () => {
    const tools = getAdvancedTools(opts);
    const script = await getScript(tools.roll_edit.handler, {
      node_id: "clip-r",
      offset_seconds: -2.5,
    });
    expect(script).toContain("-2.5");
  });

  it("large frame counts are embedded correctly", async () => {
    const tools = getPlayheadTools(opts);
    const script = await getScript(tools.set_playhead_position.handler, {
      time_seconds: 7200,
    });
    expect(script).toContain("7200");
  });

  it("fractional dB values are embedded correctly", async () => {
    const tools = getAudioTools(opts);
    const script = await getScript(tools.adjust_audio_levels.handler, {
      node_id: "clip-db",
      level_db: -18.3,
    });
    expect(script).toContain("-18.3");
  });

  it("frame rate with 3 decimal places is preserved", async () => {
    const tools = getMediaTools(opts);
    const script = await getScript(tools.set_override_frame_rate.handler, {
      item_id: "clip-fr",
      frame_rate: 29.97,
    });
    expect(script).toContain("29.97");
  });
});
