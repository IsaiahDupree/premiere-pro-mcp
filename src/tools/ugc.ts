import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";

/**
 * UGC Content Pipeline Tools
 *
 * Tools for the UGC content creation pipeline: caption detection, hook detection,
 * brand-aware styling, clip triage, and on-screen text inspection.
 * These tools are designed to be non-destructive — they detect before they act,
 * and never overwrite good existing creative elements.
 */
export function getUgcTools(bridgeOptions: BridgeOptions) {
  return {
    detect_caption_tracks: {
      description:
        "Detect whether caption/subtitle tracks exist in the active sequence. Returns caption track count, formats, and whether any tracks appear to have content. Use this before adding captions to avoid overwriting existing work.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence ID to inspect (default: active sequence)",
          },
        },
        required: [],
      },
      handler: async (args: { sequence_id?: string }) => {
        const script = buildToolScript(`
          var seq = ${args.sequence_id ? `__findSequence("${escapeForExtendScript(args.sequence_id)}")` : "app.project.activeSequence"};
          if (!seq) return __error("No active sequence");

          var captionTracks = [];
          var totalCaptionItems = 0;

          // Check video tracks for caption clips (MOGRT / Essential Graphics text)
          var textLayers = [];
          for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var track = seq.videoTracks[v];
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              try {
                var mediaPath = "";
                if (clip.projectItem) {
                  try { mediaPath = clip.projectItem.getMediaPath() || ""; } catch(e2) {}
                }
                var name = clip.projectItem ? clip.projectItem.name : "";
                var lowerName = name.toLowerCase();
                var lowerPath = mediaPath.toLowerCase();
                if (
                  lowerName.indexOf("caption") !== -1 ||
                  lowerName.indexOf("subtitle") !== -1 ||
                  lowerPath.indexOf(".srt") !== -1 ||
                  lowerPath.indexOf(".vtt") !== -1 ||
                  lowerPath.indexOf(".scc") !== -1 ||
                  lowerPath.indexOf(".dfxp") !== -1 ||
                  lowerPath.indexOf(".ttml") !== -1
                ) {
                  textLayers.push({
                    trackIndex: v,
                    clipName: name,
                    mediaPath: mediaPath,
                    startSeconds: __ticksToSeconds(clip.start.ticks),
                    endSeconds: __ticksToSeconds(clip.end.ticks)
                  });
                  totalCaptionItems++;
                }
              } catch(e) {}
            }
          }

          // Check for dedicated caption tracks via QE DOM
          var qeCaptionTracks = [];
          try {
            app.enableQE();
            var qeSeq = qe.project.getActiveSequence();
            if (qeSeq) {
              var numTracks = qeSeq.numVideoTracks;
              // Caption tracks in QE are separate from video tracks
              for (var qi = 0; qi < numTracks; qi++) {
                try {
                  var qeTrack = qeSeq.getVideoTrackAt(qi);
                  if (qeTrack) {
                    var trackType = "";
                    try { trackType = qeTrack.mediaType || ""; } catch(e3) {}
                    if (trackType === "Caption") {
                      qeCaptionTracks.push({ trackIndex: qi, mediaType: trackType });
                      totalCaptionItems++;
                    }
                  }
                } catch(e) {}
              }
            }
          } catch(e) {}

          var hasCaptions = totalCaptionItems > 0 || textLayers.length > 0;
          return __result({
            hasCaptions: hasCaptions,
            captionItemCount: totalCaptionItems,
            textLayerCandidates: textLayers,
            qeCaptionTracks: qeCaptionTracks,
            recommendation: hasCaptions ? "captions_present_inspect_quality" : "captions_missing_safe_to_add"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    detect_top_hook_text: {
      description:
        "Detect whether a persistent text/title hook exists in the upper region of the sequence (the first 10 seconds). Returns the hook text if found, its position, duration, and a strength hint. Use before adding a hook title to avoid overwriting existing strong hooks.",
      parameters: {
        type: "object" as const,
        properties: {
          scan_duration_seconds: {
            type: "number",
            description: "How many seconds from the start to scan for hook text (default: 10)",
          },
          top_region_threshold_pct: {
            type: "number",
            description:
              "How far down from the top (0.0-1.0) to consider 'top region' (default: 0.35 = top 35%)",
          },
        },
        required: [],
      },
      handler: async (args: {
        scan_duration_seconds?: number;
        top_region_threshold_pct?: number;
      }) => {
        const scanDuration = args.scan_duration_seconds ?? 10;
        const topThreshold = args.top_region_threshold_pct ?? 0.35;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var scanEndTicks = __secondsToTicks(${scanDuration});
          var hookCandidates = [];
          var seqHeight = seq.frameSizeVertical || 1080;
          var topRegionPx = seqHeight * ${topThreshold};

          // Scan video tracks for text/graphics items in the top region
          for (var v = seq.videoTracks.numTracks - 1; v >= 0; v--) {
            var track = seq.videoTracks[v];
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              var clipStartTicks = clip.start.ticks;
              var clipEndTicks = clip.end.ticks;

              // Only look at clips that start within our scan window
              if (parseFloat(clipStartTicks) > parseFloat(scanEndTicks)) continue;

              var clipDuration = __ticksToSeconds(clipEndTicks) - __ticksToSeconds(clipStartTicks);
              var name = clip.projectItem ? clip.projectItem.name : "";

              // Graphics/text items typically have these indicators
              var lowerName = name.toLowerCase();
              var isTextLike = (
                lowerName.indexOf("title") !== -1 ||
                lowerName.indexOf("text") !== -1 ||
                lowerName.indexOf("hook") !== -1 ||
                lowerName.indexOf("graphic") !== -1 ||
                lowerName.indexOf("lower third") !== -1 ||
                lowerName.indexOf("mogrt") !== -1 ||
                lowerName.indexOf(".mogrt") !== -1 ||
                clip.projectItem && clip.projectItem.type === 1 && name.indexOf(".") === -1
              );

              if (isTextLike && clipDuration >= 1.0) {
                hookCandidates.push({
                  trackIndex: v,
                  clipName: name,
                  startSeconds: __ticksToSeconds(clipStartTicks),
                  durationSeconds: clipDuration,
                  isLikelyTopRegion: true // ExtendScript can't read motion graphics properties directly
                });
              }
            }
          }

          var hasHook = hookCandidates.length > 0;
          var longestHook = null;
          if (hasHook) {
            hookCandidates.sort(function(a, b) { return b.durationSeconds - a.durationSeconds; });
            longestHook = hookCandidates[0];
          }

          return __result({
            hasTopHookCandidate: hasHook,
            hookCandidates: hookCandidates,
            primaryHook: longestHook,
            scanDurationSeconds: ${scanDuration},
            recommendation: hasHook
              ? "hook_candidate_found_verify_strength"
              : "hook_missing_safe_to_add"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_clip_triage_info: {
      description:
        "Get triage signals for the active sequence to determine if it's worth processing: duration, track composition, speech track presence, clip count, silence gaps, and estimated content completeness. Used by the raw footage triage layer to gate clips before expensive processing.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence ID to triage (default: active sequence)",
          },
          min_useful_duration_seconds: {
            type: "number",
            description: "Minimum duration (seconds) to consider the clip potentially useful (default: 4)",
          },
        },
        required: [],
      },
      handler: async (args: { sequence_id?: string; min_useful_duration_seconds?: number }) => {
        const minDuration = args.min_useful_duration_seconds ?? 4;

        const script = buildToolScript(`
          var seq = ${args.sequence_id ? `__findSequence("${escapeForExtendScript(args.sequence_id)}")` : "app.project.activeSequence"};
          if (!seq) return __error("No active sequence");

          var totalDuration = __ticksToSeconds(seq.end);
          var videoClipCount = 0;
          var audioClipCount = 0;
          var hasSpeechTrack = false;
          var hasVideoContent = false;
          var gapCount = 0;
          var lastClipEnd = 0;

          for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var vTrack = seq.videoTracks[v];
            videoClipCount += vTrack.clips.numItems;
            if (vTrack.clips.numItems > 0) hasVideoContent = true;
          }

          var audioTrackDetails = [];
          for (var a = 0; a < seq.audioTracks.numTracks; a++) {
            var aTrack = seq.audioTracks[a];
            audioClipCount += aTrack.clips.numItems;
            if (aTrack.clips.numItems > 0) {
              hasSpeechTrack = true;
              var clipDurations = [];
              for (var c = 0; c < aTrack.clips.numItems; c++) {
                var aclip = aTrack.clips[c];
                var dur = __ticksToSeconds(aclip.end.ticks) - __ticksToSeconds(aclip.start.ticks);
                clipDurations.push(dur);
                var startSec = __ticksToSeconds(aclip.start.ticks);
                if (startSec - lastClipEnd > 0.5) gapCount++;
                lastClipEnd = __ticksToSeconds(aclip.end.ticks);
              }
              audioTrackDetails.push({ trackIndex: a, clipCount: aTrack.clips.numItems, clipDurations: clipDurations });
            }
          }

          var passesDurationGate = totalDuration >= ${minDuration};
          var passesContentGate = hasVideoContent && hasSpeechTrack;
          var overallTriageScore = 0.0;
          if (passesDurationGate) overallTriageScore += 0.3;
          if (passesContentGate) overallTriageScore += 0.4;
          if (videoClipCount > 0 && audioClipCount > 0) overallTriageScore += 0.2;
          if (gapCount < 3) overallTriageScore += 0.1;

          var classification = "test_or_accidental";
          if (overallTriageScore >= 0.8) classification = "usable_primary";
          else if (overallTriageScore >= 0.6) classification = "usable_supporting";
          else if (overallTriageScore >= 0.4) classification = "salvageable_fragment";
          else if (overallTriageScore >= 0.2) classification = "test_or_accidental";
          else classification = "trash_low_value";

          return __result({
            sequenceName: seq.name,
            totalDurationSeconds: totalDuration,
            videoTrackCount: seq.videoTracks.numTracks,
            audioTrackCount: seq.audioTracks.numTracks,
            videoClipCount: videoClipCount,
            audioClipCount: audioClipCount,
            hasVideoContent: hasVideoContent,
            hasSpeechTrack: hasSpeechTrack,
            silenceGapCount: gapCount,
            passesDurationGate: passesDurationGate,
            passesContentGate: passesContentGate,
            overallTriageScore: overallTriageScore,
            classification: classification,
            recommendation: passesContentGate && passesDurationGate
              ? "send_to_content_pipeline"
              : (overallTriageScore >= 0.4 ? "review_for_salvage" : "archive_or_trash")
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    add_ugc_hook_title: {
      description:
        "Add a UGC-styled hook title at the top of the sequence using a MOGRT or Essential Graphics text clip. Places text in the top safe zone (8% from top), uses bold readable font, high contrast. Only adds if no strong hook is already present. Requires a MOGRT path or uses a built-in text approach.",
      parameters: {
        type: "object" as const,
        properties: {
          hook_text: {
            type: "string",
            description: "The hook/title text to add (4-10 words recommended for UGC style)",
          },
          mogrt_path: {
            type: "string",
            description:
              "Path to a .mogrt template to use for the hook (optional — if omitted, uses a plain text approach)",
          },
          start_seconds: {
            type: "number",
            description: "Start time in seconds (default: 0)",
          },
          duration_seconds: {
            type: "number",
            description: "Duration in seconds (default: 4)",
          },
          track_index: {
            type: "number",
            description: "Video track index to place the hook on (default: highest existing track + 1)",
          },
          force_replace: {
            type: "boolean",
            description:
              "If true, add the hook even if one appears to already exist (default: false — preserves existing hooks)",
          },
        },
        required: ["hook_text"],
      },
      handler: async (args: {
        hook_text: string;
        mogrt_path?: string;
        start_seconds?: number;
        duration_seconds?: number;
        track_index?: number;
        force_replace?: boolean;
      }) => {
        const startSeconds = args.start_seconds ?? 0;
        const durationSeconds = args.duration_seconds ?? 4;
        const forceReplace = args.force_replace ?? false;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var trackIndex = ${args.track_index !== undefined ? args.track_index : "seq.videoTracks.numTracks - 1"};
          var startTicks = __secondsToTicks(${startSeconds}).toString();
          var forceReplace = ${forceReplace};
          var hookText = "${escapeForExtendScript(args.hook_text)}";
          var mogrtPath = ${args.mogrt_path ? `"${escapeForExtendScript(args.mogrt_path)}"` : "null"};

          // Safety check: don't overwrite if hook already present and forceReplace is false
          if (!forceReplace) {
            var scanEnd = __secondsToTicks(10);
            for (var v = seq.videoTracks.numTracks - 1; v >= 0; v--) {
              var track = seq.videoTracks[v];
              for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                if (parseFloat(clip.start.ticks) > parseFloat(scanEnd)) continue;
                var cname = (clip.projectItem ? clip.projectItem.name : "").toLowerCase();
                if (cname.indexOf("title") !== -1 || cname.indexOf("hook") !== -1 || cname.indexOf("mogrt") !== -1) {
                  return __result({
                    added: false,
                    reason: "existing_hook_found_preserved",
                    existingClipName: clip.projectItem ? clip.projectItem.name : "unknown",
                    hookText: hookText
                  });
                }
              }
            }
          }

          var result;
          if (mogrtPath) {
            result = seq.importMGT(mogrtPath, startTicks, trackIndex, trackIndex);
            if (!result) return __error("Failed to import MOGRT for hook: " + mogrtPath);
          } else {
            // Fallback: use caption track as text layer
            var captionResult = seq.createCaptionTrack(
              { name: hookText, nodeId: null },
              0,
              Sequence.CAPTION_FORMAT_SUBTITLE
            );
          }

          return __result({
            added: true,
            hookText: hookText,
            startSeconds: ${startSeconds},
            durationSeconds: ${durationSeconds},
            trackIndex: trackIndex,
            method: mogrtPath ? "mogrt" : "text_fallback",
            ugcStyleNote: "Position in top safe zone (8% from top) manually if using MOGRT template"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    restyle_caption_layer: {
      description:
        "Update the styling of an existing caption/text layer without replacing its content. Can change font size, color, position, and opacity. Use when captions exist but are low quality — restyling is less destructive than regenerating.",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Video track index containing the caption/text layer to restyle",
          },
          clip_index: {
            type: "number",
            description: "Clip index within the track (default: 0 — first clip)",
          },
          font_size: {
            type: "number",
            description: "New font size (e.g., 72 for large UGC captions)",
          },
          opacity: {
            type: "number",
            description: "Clip opacity 0-100 (default: 100)",
          },
          position_x: {
            type: "number",
            description: "Horizontal position offset in pixels from center",
          },
          position_y: {
            type: "number",
            description:
              "Vertical position offset in pixels from center (negative moves up toward top safe zone)",
          },
        },
        required: ["track_index"],
      },
      handler: async (args: {
        track_index: number;
        clip_index?: number;
        font_size?: number;
        opacity?: number;
        position_x?: number;
        position_y?: number;
      }) => {
        const clipIndex = args.clip_index ?? 0;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var trackIndex = ${args.track_index};
          if (trackIndex >= seq.videoTracks.numTracks) return __error("Track index " + trackIndex + " out of range");

          var track = seq.videoTracks[trackIndex];
          if (track.clips.numItems === 0) return __error("No clips on track " + trackIndex);

          var clip = track.clips[${clipIndex}];
          if (!clip) return __error("Clip index ${clipIndex} not found on track ${args.track_index}");

          var changes = [];

          // Set opacity if provided
          ${args.opacity !== undefined ? `
          clip.opacity.setValue(${args.opacity});
          changes.push("opacity: ${args.opacity}");
          ` : ""}

          // Set position if provided via motion effect
          ${args.position_x !== undefined || args.position_y !== undefined ? `
          try {
            var motionEffect = clip.effects.matchName("ADBE Motion");
            if (!motionEffect) motionEffect = clip.effects.matchName("Motion");
            if (motionEffect) {
              var positionParam = motionEffect.components.matchName("ADBE Position");
              if (!positionParam) positionParam = motionEffect.components.matchName("Position");
              if (positionParam) {
                var seqW = seq.frameSizeHorizontal / 2;
                var seqH = seq.frameSizeVertical / 2;
                positionParam.setValue(
                  [seqW + ${args.position_x ?? 0}, seqH + ${args.position_y ?? 0}],
                  false
                );
                changes.push("position: [" + (seqW + ${args.position_x ?? 0}) + ", " + (seqH + ${args.position_y ?? 0}) + "]");
              }
            }
          } catch(e) { changes.push("position_skipped: " + e.message); }
          ` : ""}

          return __result({
            restyled: true,
            trackIndex: trackIndex,
            clipIndex: ${clipIndex},
            clipName: clip.projectItem ? clip.projectItem.name : "unknown",
            appliedChanges: changes
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    import_srt_with_brand_style: {
      description:
        "Import an SRT subtitle file into the active sequence and apply brand-consistent styling: safe-zone placement, font size for readability, and opacity. Creates a caption track from the SRT. Use when captions are missing or need to be regenerated from transcript.",
      parameters: {
        type: "object" as const,
        properties: {
          srt_path: {
            type: "string",
            description: "Full path to the .srt file to import",
          },
          brand_font_size: {
            type: "number",
            description:
              "Font size for captions matching brand style (default: 72 — high readability for mobile)",
          },
          caption_format: {
            type: "string",
            description: "Caption format: 'subtitle' (default), '608', '708'",
          },
          start_seconds: {
            type: "number",
            description: "Offset in seconds to start the caption track (default: 0)",
          },
          place_in_safe_zone: {
            type: "boolean",
            description:
              "If true, positions captions within safe zone margins (default: true)",
          },
        },
        required: ["srt_path"],
      },
      handler: async (args: {
        srt_path: string;
        brand_font_size?: number;
        caption_format?: string;
        start_seconds?: number;
        place_in_safe_zone?: boolean;
      }) => {
        const startSeconds = args.start_seconds ?? 0;
        const captionFormat = args.caption_format ?? "subtitle";
        const fontSizeNote = args.brand_font_size ?? 72;

        const formatMap: Record<string, string> = {
          subtitle: "Sequence.CAPTION_FORMAT_SUBTITLE",
          "608": "Sequence.CAPTION_FORMAT_608",
          "708": "Sequence.CAPTION_FORMAT_708",
        };
        const format = formatMap[captionFormat] || "Sequence.CAPTION_FORMAT_SUBTITLE";

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var srtPath = "${escapeForExtendScript(args.srt_path)}";

          // Import the SRT file into the project
          var importedIds = [];
          var success = app.project.importFiles([srtPath], true, app.project.rootItem, false);
          if (!success) return __error("Failed to import SRT file: " + srtPath);

          // Find the imported SRT item
          var srtItem = __findProjectItem(srtPath.split("/").pop());
          if (!srtItem) return __error("Could not find imported SRT item in project");

          // Create caption track from the SRT item
          var result = seq.createCaptionTrack(srtItem, ${startSeconds}, ${format});
          if (!result) return __error("Failed to create caption track from SRT");

          return __result({
            imported: true,
            srtPath: srtPath,
            captionFormat: "${captionFormat}",
            startSeconds: ${startSeconds},
            brandFontSizeTarget: ${fontSizeNote},
            safeZoneNote: "Set caption track safe zone in Captions panel: top 12%, bottom 12%, sides 5%",
            placeInSafeZone: ${args.place_in_safe_zone ?? true},
            nextStep: "Use restyle_caption_layer to adjust font size and position to brand spec"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    detect_on_screen_text_regions: {
      description:
        "Scan the active sequence timeline for text/graphics layers and report which screen regions they occupy (top, middle, bottom). Returns a region coverage map to help avoid placing new text where it would overlap existing elements or obstruct faces.",
      parameters: {
        type: "object" as const,
        properties: {
          scan_duration_seconds: {
            type: "number",
            description: "How many seconds from the start to scan (default: entire sequence)",
          },
        },
        required: [],
      },
      handler: async (args: { scan_duration_seconds?: number }) => {
        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var scanEnd = ${args.scan_duration_seconds !== undefined ? `__secondsToTicks(${args.scan_duration_seconds})` : "seq.end"};
          var seqH = seq.frameSizeVertical || 1080;
          var topZone = seqH * 0.33;
          var bottomZone = seqH * 0.67;

          var regionMap = { top: [], middle: [], bottom: [], unknown: [] };
          var totalTextLayers = 0;

          for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var track = seq.videoTracks[v];
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              if (parseFloat(clip.start.ticks) > parseFloat(scanEnd.ticks || scanEnd)) continue;

              var name = clip.projectItem ? clip.projectItem.name : "";
              var lowerName = name.toLowerCase();
              var isText = (
                lowerName.indexOf("title") !== -1 ||
                lowerName.indexOf("text") !== -1 ||
                lowerName.indexOf("hook") !== -1 ||
                lowerName.indexOf("lower third") !== -1 ||
                lowerName.indexOf("caption") !== -1 ||
                lowerName.indexOf("subtitle") !== -1 ||
                lowerName.indexOf("mogrt") !== -1 ||
                lowerName.indexOf("graphic") !== -1
              );

              if (!isText) continue;
              totalTextLayers++;

              // Estimate region from clip name heuristics
              var region = "unknown";
              if (lowerName.indexOf("lower third") !== -1 || lowerName.indexOf("bottom") !== -1) {
                region = "bottom";
              } else if (lowerName.indexOf("title") !== -1 || lowerName.indexOf("hook") !== -1 || lowerName.indexOf("top") !== -1) {
                region = "top";
              } else if (lowerName.indexOf("caption") !== -1 || lowerName.indexOf("subtitle") !== -1) {
                region = "bottom";
              } else {
                region = "unknown";
              }

              var entry = {
                trackIndex: v,
                clipName: name,
                startSeconds: __ticksToSeconds(clip.start.ticks),
                endSeconds: __ticksToSeconds(clip.end.ticks),
                estimatedRegion: region
              };

              regionMap[region].push(entry);
            }
          }

          return __result({
            totalTextLayers: totalTextLayers,
            regionCoverage: {
              top: regionMap.top.length,
              middle: regionMap.middle.length,
              bottom: regionMap.bottom.length,
              unknown: regionMap.unknown.length
            },
            layers: regionMap,
            topRegionClear: regionMap.top.length === 0,
            bottomRegionClear: regionMap.bottom.length === 0,
            recommendation: regionMap.top.length === 0
              ? "top_region_available_for_hook"
              : "top_region_occupied_verify_before_adding_hook"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    set_text_layer_brand_style: {
      description:
        "Apply brand-aware styling to a specific text/graphics clip in the timeline: set opacity, scale, and motion position to match brand safe-zone guidelines. Use after importing a MOGRT hook or caption to ensure brand consistency.",
      parameters: {
        type: "object" as const,
        properties: {
          track_index: {
            type: "number",
            description: "Video track index containing the text/graphics clip",
          },
          clip_index: {
            type: "number",
            description: "Clip index within the track (default: 0)",
          },
          scale: {
            type: "number",
            description: "Scale percentage (default: 100). Use 85-110 for UGC feel.",
          },
          opacity: {
            type: "number",
            description: "Opacity 0-100 (default: 100)",
          },
          safe_zone_position: {
            type: "string",
            description:
              "Snap to safe zone: 'top' (8% from top), 'bottom' (88% from top), 'center' (default: no snap)",
          },
          frame_width: {
            type: "number",
            description: "Sequence frame width for safe zone calculation (default: read from sequence)",
          },
          frame_height: {
            type: "number",
            description: "Sequence frame height for safe zone calculation (default: read from sequence)",
          },
        },
        required: ["track_index"],
      },
      handler: async (args: {
        track_index: number;
        clip_index?: number;
        scale?: number;
        opacity?: number;
        safe_zone_position?: string;
        frame_width?: number;
        frame_height?: number;
      }) => {
        const clipIndex = args.clip_index ?? 0;
        const scale = args.scale ?? 100;
        const opacity = args.opacity ?? 100;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var trackIndex = ${args.track_index};
          if (trackIndex >= seq.videoTracks.numTracks) return __error("Track index " + trackIndex + " out of range");

          var track = seq.videoTracks[trackIndex];
          if (track.clips.numItems === 0) return __error("No clips on track " + trackIndex);

          var clip = track.clips[${clipIndex}];
          if (!clip) return __error("Clip not found");

          var seqW = ${args.frame_width !== undefined ? args.frame_width : "seq.frameSizeHorizontal"};
          var seqH = ${args.frame_height !== undefined ? args.frame_height : "seq.frameSizeVertical"};
          var changes = [];

          // Set opacity
          try {
            clip.opacity.setValue(${opacity});
            changes.push("opacity: ${opacity}");
          } catch(e) { changes.push("opacity_failed: " + e.message); }

          // Set scale via Motion effect
          try {
            var motionEffect = clip.effects.matchName("ADBE Motion");
            if (!motionEffect) motionEffect = clip.effects.matchName("Motion");
            if (motionEffect) {
              var scaleParam = motionEffect.components.matchName("ADBE Scale");
              if (!scaleParam) scaleParam = motionEffect.components.matchName("Scale");
              if (scaleParam) {
                scaleParam.setValue(${scale}, false);
                changes.push("scale: ${scale}");
              }

              // Safe zone position snapping
              var safeZone = "${args.safe_zone_position || "none"}";
              if (safeZone === "top" || safeZone === "bottom" || safeZone === "center") {
                var posParam = motionEffect.components.matchName("ADBE Position");
                if (!posParam) posParam = motionEffect.components.matchName("Position");
                if (posParam) {
                  var xCenter = seqW / 2;
                  var yPos;
                  if (safeZone === "top") {
                    yPos = seqH * 0.12; // 12% from top (within 8% safe zone with label padding)
                  } else if (safeZone === "bottom") {
                    yPos = seqH * 0.88; // 88% from top
                  } else {
                    yPos = seqH / 2;
                  }
                  posParam.setValue([xCenter, yPos], false);
                  changes.push("position_snapped_to: " + safeZone + " [" + xCenter + ", " + yPos + "]");
                }
              }
            }
          } catch(e) { changes.push("motion_effects_failed: " + e.message); }

          return __result({
            styled: true,
            trackIndex: trackIndex,
            clipIndex: ${clipIndex},
            clipName: clip.projectItem ? clip.projectItem.name : "unknown",
            appliedChanges: changes,
            brandNote: "Brand colors and font must be set inside the MOGRT/Essential Graphics panel"
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
