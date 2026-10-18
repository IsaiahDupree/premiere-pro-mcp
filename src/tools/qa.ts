import { buildToolScript, escapeForExtendScript } from "../bridge/script-builder.js";
import { sendCommand, BridgeOptions } from "../bridge/file-bridge.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Video QA + Decision Engine Tools
 *
 * Tools for the pre-publish QA inspection layer. These tools score a sequence
 * against publish/retry/trash thresholds, run structured inspections, and log
 * learnings for future improvement. The decision engine is non-destructive:
 * it reports decisions but does not execute them automatically.
 */
export function getQaTools(bridgeOptions: BridgeOptions) {
  return {
    run_video_qa: {
      description:
        "Run a full QA inspection on the active sequence. Returns a structured QA result with caption status, hook status, triage scores, and a preliminary decision (publish / light_retry / full_recreate / trash). This is the main gate before any content is queued for publish.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence ID to inspect (default: active sequence)",
          },
          publish_threshold: {
            type: "number",
            description: "Minimum overall quality score to pass for publish (default: 0.82)",
          },
          light_retry_threshold: {
            type: "number",
            description: "Score below which a light retry is triggered (default: 0.68)",
          },
          trash_threshold: {
            type: "number",
            description: "Score below which the concept is trashed (default: 0.50)",
          },
        },
        required: [],
      },
      handler: async (args: {
        sequence_id?: string;
        publish_threshold?: number;
        light_retry_threshold?: number;
        trash_threshold?: number;
      }) => {
        const publishThreshold = args.publish_threshold ?? 0.82;
        const lightRetryThreshold = args.light_retry_threshold ?? 0.68;
        const trashThreshold = args.trash_threshold ?? 0.50;

        const script = buildToolScript(`
          var seq = ${args.sequence_id ? `__findSequence("${escapeForExtendScript(args.sequence_id)}")` : "app.project.activeSequence"};
          if (!seq) return __error("No active sequence");

          var seqDuration = __ticksToSeconds(seq.end);
          var videoTracks = seq.videoTracks.numTracks;
          var audioTracks = seq.audioTracks.numTracks;
          var videoClipCount = 0;
          var audioClipCount = 0;
          var hasSpeech = false;
          var hasVideo = false;

          for (var v = 0; v < videoTracks; v++) {
            videoClipCount += seq.videoTracks[v].clips.numItems;
            if (seq.videoTracks[v].clips.numItems > 0) hasVideo = true;
          }
          for (var a = 0; a < audioTracks; a++) {
            audioClipCount += seq.audioTracks[a].clips.numItems;
            if (seq.audioTracks[a].clips.numItems > 0) hasSpeech = true;
          }

          // Caption detection
          var captionStatus = "missing";
          var captionScore = 0.0;
          var captionItems = 0;
          for (var tv = 0; tv < videoTracks; tv++) {
            var tr = seq.videoTracks[tv];
            for (var ci = 0; ci < tr.clips.numItems; ci++) {
              var clip = tr.clips[ci];
              var nm = (clip.projectItem ? clip.projectItem.name : "").toLowerCase();
              var mp = "";
              try { mp = (clip.projectItem ? clip.projectItem.getMediaPath() : "") || ""; } catch(e) {}
              mp = mp.toLowerCase();
              if (nm.indexOf("caption") !== -1 || nm.indexOf("subtitle") !== -1 ||
                  mp.indexOf(".srt") !== -1 || mp.indexOf(".vtt") !== -1) {
                captionItems++;
              }
            }
          }
          if (captionItems > 0) {
            captionStatus = "present";
            captionScore = 0.8; // Assumed good; full OCR check requires external tooling
          } else {
            captionStatus = "missing";
            captionScore = 0.0;
          }

          // Hook detection (top-region text in first 10s)
          var hookStatus = "missing";
          var hookScore = 0.0;
          var hookItems = 0;
          var hookScanTicks = __secondsToTicks(10);
          for (var hv = videoTracks - 1; hv >= 0; hv--) {
            var hTrack = seq.videoTracks[hv];
            for (var hc = 0; hc < hTrack.clips.numItems; hc++) {
              var hclip = hTrack.clips[hc];
              if (parseFloat(hclip.start.ticks) > parseFloat(hookScanTicks)) continue;
              var hname = (hclip.projectItem ? hclip.projectItem.name : "").toLowerCase();
              if (hname.indexOf("title") !== -1 || hname.indexOf("hook") !== -1 ||
                  hname.indexOf("mogrt") !== -1 || hname.indexOf("graphic") !== -1) {
                hookItems++;
              }
            }
          }
          if (hookItems > 0) {
            hookStatus = "present";
            hookScore = 0.75; // Can't fully verify strength without OCR
          } else {
            hookStatus = "missing";
            hookScore = 0.0;
          }

          // Triage / content quality signals
          var durationScore = seqDuration >= 10 ? 1.0 : (seqDuration >= 4 ? 0.6 : 0.2);
          var contentScore = (hasVideo && hasSpeech) ? 1.0 : (hasVideo || hasSpeech ? 0.5 : 0.0);
          var trackCompositionScore = (videoClipCount > 0 && audioClipCount > 0) ? 1.0 : 0.3;

          // Weighted overall score
          // caption: 0.20, hook: 0.20, readability~content: 0.15, triage~duration: 0.15,
          // brand~placeholder: 0.10, ugc: 0.10, visual_clarity: 0.10
          var overallScore =
            (captionScore * 0.20) +
            (hookScore * 0.20) +
            (contentScore * 0.15) +
            (durationScore * 0.15) +
            (0.7 * 0.10) +   // brand: assume moderate (requires external check)
            (0.65 * 0.10) +  // ugc feel: assume moderate
            (trackCompositionScore * 0.10);

          var publishThreshold = ${publishThreshold};
          var lightRetryThreshold = ${lightRetryThreshold};
          var trashThreshold = ${trashThreshold};

          var decision;
          var reasons = [];
          if (overallScore >= publishThreshold) {
            decision = "publish";
          } else if (overallScore >= lightRetryThreshold) {
            decision = "light_retry";
            if (captionScore < 0.5) reasons.push("captions_missing_or_weak");
            if (hookScore < 0.5) reasons.push("hook_missing_or_weak");
          } else if (overallScore >= trashThreshold) {
            decision = "full_recreate";
            reasons.push("below_light_retry_threshold");
          } else {
            decision = "trash";
            reasons.push("below_trash_threshold");
            if (!hasVideo) reasons.push("no_video_content");
            if (!hasSpeech) reasons.push("no_audio_speech");
            if (seqDuration < 4) reasons.push("duration_too_short");
          }

          return __result({
            sequenceName: seq.name,
            durationSeconds: seqDuration,
            captions: {
              status: captionStatus,
              itemCount: captionItems,
              score: captionScore,
              action: captionStatus === "present" ? "keep" : "regenerate"
            },
            hook: {
              status: hookStatus,
              itemCount: hookItems,
              score: hookScore,
              action: hookStatus === "present" ? "verify_strength" : "generate"
            },
            triage: {
              durationScore: durationScore,
              contentScore: contentScore,
              trackCompositionScore: trackCompositionScore,
              hasVideo: hasVideo,
              hasSpeech: hasSpeech
            },
            scores: {
              caption: captionScore,
              hook: hookScore,
              content: contentScore,
              duration: durationScore,
              overall: overallScore
            },
            thresholds: {
              publish: publishThreshold,
              lightRetry: lightRetryThreshold,
              trash: trashThreshold
            },
            decision: {
              finalAction: decision,
              overallScore: overallScore,
              reasons: reasons
            }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    score_sequence_for_publish: {
      description:
        "Score the active sequence and return a concise publish decision with score breakdown. Lighter than run_video_qa — use for quick pass/fail checks during the edit loop.",
      parameters: {
        type: "object" as const,
        properties: {
          publish_threshold: {
            type: "number",
            description: "Minimum score to pass (default: 0.82)",
          },
        },
        required: [],
      },
      handler: async (args: { publish_threshold?: number }) => {
        const threshold = args.publish_threshold ?? 0.82;

        const script = buildToolScript(`
          var seq = app.project.activeSequence;
          if (!seq) return __error("No active sequence");

          var duration = __ticksToSeconds(seq.end);
          var videoClips = 0;
          var audioClips = 0;
          var captionFound = false;
          var hookFound = false;

          for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var tr = seq.videoTracks[v];
            videoClips += tr.clips.numItems;
            for (var c = 0; c < tr.clips.numItems; c++) {
              var clip = tr.clips[c];
              var n = (clip.projectItem ? clip.projectItem.name : "").toLowerCase();
              if (n.indexOf("caption") !== -1 || n.indexOf("subtitle") !== -1) captionFound = true;
              if (n.indexOf("title") !== -1 || n.indexOf("hook") !== -1 || n.indexOf("mogrt") !== -1) hookFound = true;
            }
          }
          for (var a = 0; a < seq.audioTracks.numTracks; a++) {
            audioClips += seq.audioTracks[a].clips.numItems;
          }

          var score = 0.0;
          if (captionFound) score += 0.25;
          if (hookFound) score += 0.25;
          if (duration >= 10) score += 0.20;
          else if (duration >= 4) score += 0.12;
          if (videoClips > 0) score += 0.15;
          if (audioClips > 0) score += 0.15;

          var passes = score >= ${threshold};
          return __result({
            score: score,
            threshold: ${threshold},
            passes: passes,
            decision: passes ? "publish" : (score >= 0.68 ? "light_retry" : (score >= 0.50 ? "full_recreate" : "trash")),
            breakdown: {
              captions: captionFound ? 0.25 : 0.0,
              hook: hookFound ? 0.25 : 0.0,
              duration: duration >= 10 ? 0.20 : (duration >= 4 ? 0.12 : 0.0),
              video: videoClips > 0 ? 0.15 : 0.0,
              audio: audioClips > 0 ? 0.15 : 0.0
            }
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },

    get_qa_decision: {
      description:
        "Given a pre-computed overall quality score and retry count, return the correct decision (publish / light_retry / full_recreate / trash) and what action the system should take next. Use this as the final decision gate in the QA loop.",
      parameters: {
        type: "object" as const,
        properties: {
          overall_score: {
            type: "number",
            description: "The overall quality score (0.0-1.0) from run_video_qa or score_sequence_for_publish",
          },
          retry_count: {
            type: "number",
            description: "How many times this concept has already been retried (default: 0)",
          },
          max_light_retries: {
            type: "number",
            description: "Maximum light retries before escalating (default: 2)",
          },
          max_full_recreations: {
            type: "number",
            description: "Maximum full recreations before trashing (default: 2)",
          },
          publish_threshold: {
            type: "number",
            description: "Minimum score to publish (default: 0.82)",
          },
          light_retry_threshold: {
            type: "number",
            description: "Score floor for light retry (default: 0.68)",
          },
          trash_threshold: {
            type: "number",
            description: "Score below which the concept is trashed (default: 0.50)",
          },
        },
        required: ["overall_score"],
      },
      handler: async (args: {
        overall_score: number;
        retry_count?: number;
        max_light_retries?: number;
        max_full_recreations?: number;
        publish_threshold?: number;
        light_retry_threshold?: number;
        trash_threshold?: number;
      }) => {
        const score = args.overall_score;
        const retryCount = args.retry_count ?? 0;
        const maxLightRetries = args.max_light_retries ?? 2;
        const maxFullRecreations = args.max_full_recreations ?? 2;
        const maxTotal = maxLightRetries + maxFullRecreations;
        const publishThreshold = args.publish_threshold ?? 0.82;
        const lightRetryThreshold = args.light_retry_threshold ?? 0.68;
        const trashThreshold = args.trash_threshold ?? 0.50;

        let decision: string;
        let nextAction: string;
        let reasons: string[] = [];

        if (retryCount >= maxTotal) {
          decision = "trash";
          nextAction = "log_learnings_and_discard";
          reasons.push(`max_total_attempts_reached (${retryCount}/${maxTotal})`);
        } else if (score >= publishThreshold) {
          decision = "publish";
          nextAction = "queue_for_publish";
        } else if (score >= lightRetryThreshold) {
          if (retryCount < maxLightRetries) {
            decision = "light_retry";
            nextAction = "apply_light_fixes_reposition_text_adjust_contrast_reshorten_hook";
            reasons.push(`score_${score.toFixed(2)}_below_publish_threshold_${publishThreshold}`);
          } else {
            decision = "full_recreate";
            nextAction = "rebuild_with_different_broll_hook_or_edit_style";
            reasons.push(`light_retry_limit_reached (${retryCount}/${maxLightRetries})`);
          }
        } else if (score >= trashThreshold) {
          decision = "full_recreate";
          nextAction = "rebuild_with_different_broll_hook_or_edit_style";
          reasons.push(`score_${score.toFixed(2)}_below_light_retry_threshold`);
        } else {
          decision = "trash";
          nextAction = "log_learnings_and_discard";
          reasons.push(`score_${score.toFixed(2)}_below_trash_threshold_${trashThreshold}`);
        }

        return {
          success: true,
          data: {
            decision,
            nextAction,
            reasons,
            score,
            retryCount,
            thresholds: {
              publish: publishThreshold,
              lightRetry: lightRetryThreshold,
              trash: trashThreshold,
            },
            retryPolicy: {
              maxLightRetries,
              maxFullRecreations,
              maxTotal,
              retryBudgetRemaining: Math.max(0, maxTotal - retryCount),
            },
          },
        };
      },
    },

    log_qa_learning: {
      description:
        "Write a structured learning record to a local JSON file so failed or successful QA outcomes can inform future content generation. Appends to a learnings log at the specified path. This is how the system improves over time.",
      parameters: {
        type: "object" as const,
        properties: {
          video_id: {
            type: "string",
            description: "Identifier for the video/sequence this learning applies to",
          },
          attempt_number: {
            type: "number",
            description: "Which attempt this record describes (1, 2, 3...)",
          },
          result: {
            type: "string",
            description: "Outcome: 'published', 'light_retry', 'full_recreate', 'trash'",
          },
          overall_score: {
            type: "number",
            description: "The overall QA score for this attempt (0.0-1.0)",
          },
          failure_reasons: {
            type: "array",
            description: "List of failure reason strings (e.g. ['hook_not_strong_enough', 'caption_density_too_high'])",
          },
          content_features: {
            type: "object",
            description:
              "Content metadata: { niche, platform, format, video_length_sec, funnel_stage }",
          },
          recommended_improvements: {
            type: "array",
            description: "List of improvement suggestions for future generations",
          },
          learnings_file_path: {
            type: "string",
            description:
              "Full path to the JSON learnings log file (default: /tmp/premiere-mcp-qa-learnings.json)",
          },
        },
        required: ["video_id", "result"],
      },
      handler: async (args: {
        video_id: string;
        attempt_number?: number;
        result: string;
        overall_score?: number;
        failure_reasons?: string[];
        content_features?: Record<string, unknown>;
        recommended_improvements?: string[];
        learnings_file_path?: string;
      }) => {
        const learningsPath =
          args.learnings_file_path ?? "/tmp/premiere-mcp-qa-learnings.json";

        const record = {
          video_id: args.video_id,
          attempt: args.attempt_number ?? 1,
          result: args.result,
          overall_score: args.overall_score ?? null,
          failure_reasons: args.failure_reasons ?? [],
          content_features: args.content_features ?? {},
          recommended_improvements: args.recommended_improvements ?? [],
          logged_at: new Date().toISOString(),
        };

        let existing: unknown[] = [];
        if (fs.existsSync(learningsPath)) {
          try {
            const raw = fs.readFileSync(learningsPath, "utf8");
            existing = JSON.parse(raw);
            if (!Array.isArray(existing)) existing = [];
          } catch {
            existing = [];
          }
        }

        existing.push(record);
        fs.writeFileSync(learningsPath, JSON.stringify(existing, null, 2), "utf8");

        return {
          success: true,
          data: {
            logged: true,
            learningsFilePath: learningsPath,
            totalRecords: existing.length,
            record,
          },
        };
      },
    },

    get_qa_learning_history: {
      description:
        "Read the QA learnings log to retrieve past failure reasons, scores, and improvement recommendations. Use this context when composing new content to avoid repeating known failures.",
      parameters: {
        type: "object" as const,
        properties: {
          learnings_file_path: {
            type: "string",
            description:
              "Full path to the JSON learnings log file (default: /tmp/premiere-mcp-qa-learnings.json)",
          },
          limit: {
            type: "number",
            description: "Maximum number of recent records to return (default: 20)",
          },
          result_filter: {
            type: "string",
            description:
              "Filter by result type: 'published', 'light_retry', 'full_recreate', 'trash' (default: all)",
          },
        },
        required: [],
      },
      handler: async (args: {
        learnings_file_path?: string;
        limit?: number;
        result_filter?: string;
      }) => {
        const learningsPath =
          args.learnings_file_path ?? "/tmp/premiere-mcp-qa-learnings.json";
        const limit = args.limit ?? 20;

        if (!fs.existsSync(learningsPath)) {
          return {
            success: true,
            data: { records: [], total: 0, message: "No learnings file found yet" },
          };
        }

        let records: Array<Record<string, unknown>> = [];
        try {
          const raw = fs.readFileSync(learningsPath, "utf8");
          records = JSON.parse(raw);
          if (!Array.isArray(records)) records = [];
        } catch {
          return {
            success: false,
            error: "Failed to parse learnings file",
          };
        }

        if (args.result_filter) {
          records = records.filter((r) => r.result === args.result_filter);
        }

        // Return most recent first
        records = records.slice(-limit).reverse();

        // Aggregate common failure patterns
        const failureCounts: Record<string, number> = {};
        for (const r of records) {
          const reasons = (r.failure_reasons as string[]) ?? [];
          for (const reason of reasons) {
            failureCounts[reason] = (failureCounts[reason] ?? 0) + 1;
          }
        }

        const topFailures = Object.entries(failureCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 5)
          .map(([reason, count]) => ({ reason, count }));

        return {
          success: true,
          data: {
            records,
            total: records.length,
            topFailurePatterns: topFailures,
            learningsFilePath: learningsPath,
          },
        };
      },
    },

    analyze_clip_watchability: {
      description:
        "Analyze a sequence's watchability signals for the raw footage triage layer: checks duration, speech/video presence, gap count, and clip composition to return a watchability score and classification. Use this before committing expensive processing to a clip.",
      parameters: {
        type: "object" as const,
        properties: {
          sequence_id: {
            type: "string",
            description: "Sequence ID to analyze (default: active sequence)",
          },
          min_duration_seconds: {
            type: "number",
            description: "Minimum duration in seconds to score as potentially watchable (default: 4)",
          },
          min_clip_count: {
            type: "number",
            description: "Minimum number of clips (video + audio) to pass content gate (default: 2)",
          },
        },
        required: [],
      },
      handler: async (args: {
        sequence_id?: string;
        min_duration_seconds?: number;
        min_clip_count?: number;
      }) => {
        const minDuration = args.min_duration_seconds ?? 4;
        const minClipCount = args.min_clip_count ?? 2;

        const script = buildToolScript(`
          var seq = ${args.sequence_id ? `__findSequence("${escapeForExtendScript(args.sequence_id)}")` : "app.project.activeSequence"};
          if (!seq) return __error("No active sequence");

          var duration = __ticksToSeconds(seq.end);
          var videoClips = 0;
          var audioClips = 0;
          var gapCount = 0;
          var prevEnd = 0;
          var totalSpeechDuration = 0;

          for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            videoClips += seq.videoTracks[v].clips.numItems;
          }
          for (var a = 0; a < seq.audioTracks.numTracks; a++) {
            var aTrack = seq.audioTracks[a];
            for (var c = 0; c < aTrack.clips.numItems; c++) {
              audioClips++;
              var clip = aTrack.clips[c];
              var startSec = __ticksToSeconds(clip.start.ticks);
              var endSec = __ticksToSeconds(clip.end.ticks);
              totalSpeechDuration += (endSec - startSec);
              if (startSec - prevEnd > 0.5 && prevEnd > 0) gapCount++;
              prevEnd = endSec;
            }
          }

          var totalClips = videoClips + audioClips;
          var passesDuration = duration >= ${minDuration};
          var passesClipCount = totalClips >= ${minClipCount};
          var hasSpeech = audioClips > 0;
          var hasVideo = videoClips > 0;
          var speechCoverage = duration > 0 ? (totalSpeechDuration / duration) : 0;

          // Watchability score (0-1)
          var score = 0.0;
          score += passesDuration ? 0.20 : (duration >= 2 ? 0.10 : 0.0);
          score += hasVideo ? 0.20 : 0.0;
          score += hasSpeech ? 0.20 : 0.0;
          score += speechCoverage >= 0.5 ? 0.15 : (speechCoverage >= 0.25 ? 0.08 : 0.0);
          score += passesClipCount ? 0.10 : 0.0;
          score += gapCount < 2 ? 0.10 : (gapCount < 5 ? 0.05 : 0.0);
          score += (videoClips > 0 && audioClips > 0) ? 0.05 : 0.0;

          var classification = "trash_low_value";
          if (score >= 0.80) classification = "usable_primary";
          else if (score >= 0.60) classification = "usable_supporting";
          else if (score >= 0.40) classification = "salvageable_fragment";
          else if (score >= 0.20) classification = "test_or_accidental";

          return __result({
            sequenceName: seq.name,
            durationSeconds: duration,
            videoClipCount: videoClips,
            audioClipCount: audioClips,
            totalClipCount: totalClips,
            hasVideo: hasVideo,
            hasSpeech: hasSpeech,
            silenceGapCount: gapCount,
            speechCoverage: speechCoverage,
            watchabilityScore: score,
            classification: classification,
            passesDurationGate: passesDuration,
            passesClipCountGate: passesClipCount,
            recommendedAction: score >= 0.60
              ? "send_to_content_pipeline"
              : (score >= 0.40 ? "review_for_salvage" : "archive_or_trash")
          });
        `);
        return sendCommand(script, bridgeOptions);
      },
    },
  };
}
