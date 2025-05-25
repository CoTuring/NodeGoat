#!/usr/bin/env node

/**
 * Post analysis results as a GitHub PR comment
 * This script formats and posts the hackathon analysis results
 */

const { getOctokit } = require("@actions/github");
const core = require("@actions/core");

// Parse inputs from environment variables
const inputs = {
  overall_score: parseInt(process.env.OVERALL_SCORE),
  test_score: parseInt(process.env.TEST_SCORE),
  sonar_score: parseInt(process.env.SONAR_SCORE),
  security_score: parseInt(process.env.SECURITY_SCORE),
  frontend_score: parseInt(process.env.FRONTEND_SCORE),
  team_score: parseInt(process.env.TEAM_SCORE),
  ai_score: parseInt(process.env.AI_SCORE),
  high_severity: parseInt(process.env.HIGH_SEVERITY || "0"),
  medium_severity: parseInt(process.env.MEDIUM_SEVERITY || "0"),
  low_severity: parseInt(process.env.LOW_SEVERITY || "0"),
  coverage_percentage: parseFloat(process.env.COVERAGE_PERCENTAGE || "0"),
  test_files: parseInt(process.env.TEST_FILES || "0"),
  sonar_status: process.env.SONAR_STATUS,
  code_smells: parseInt(process.env.CODE_SMELLS || "0"),
  bugs: parseInt(process.env.BUGS || "0"),
  vulnerabilities: parseInt(process.env.VULNERABILITIES || "0"),
  team_name: process.env.TEAM_NAME,
  detected_stack: process.env.DETECTED_STACK,
  sonar_url: process.env.SONAR_URL,
  pr_number: parseInt(process.env.PR_NUMBER),
  sonar_analysis_results: process.env.SONAR_ANALYSIS_RESULTS || "{}",
};

// GitHub context
const github_token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const run_id = process.env.GITHUB_RUN_ID;

if (!github_token || !repository) {
  console.error(
    "Missing required environment variables: GITHUB_TOKEN, GITHUB_REPOSITORY"
  );
  process.exit(1);
}

const [owner, repo] = repository.split("/");

// Initialize Octokit
const octokit = getOctokit(github_token);

// Helper function to format detailed SonarCloud issues
function formatDetailedSonarIssues(sonarResults) {
  if (!sonarResults || !sonarResults.detailed_issues) {
    return "";
  }

  let formattedIssues = "";
  const { bugs, vulnerabilities, code_smells } = sonarResults.detailed_issues;

  // Format bugs
  if (
    bugs &&
    bugs.trim() &&
    bugs !== "Too many issues - check SonarCloud report"
  ) {
    formattedIssues += "\n**🐛 Bugs Found:**\n" + bugs + "\n";
  } else if (sonarResults.summary && parseInt(sonarResults.summary.bugs) > 0) {
    formattedIssues +=
      "\n**🐛 Bugs Found:** " +
      sonarResults.summary.bugs +
      " bugs detected. Check the [SonarCloud report](" +
      inputs.sonar_url +
      ") for details.\n";
  }

  // Format vulnerabilities
  if (
    vulnerabilities &&
    vulnerabilities.trim() &&
    vulnerabilities !== "Too many issues - check SonarCloud report"
  ) {
    formattedIssues +=
      "\n**🔒 Security Vulnerabilities:**\n" + vulnerabilities + "\n";
  } else if (
    sonarResults.summary &&
    parseInt(sonarResults.summary.vulnerabilities) > 0
  ) {
    formattedIssues +=
      "\n**🔒 Security Vulnerabilities:** " +
      sonarResults.summary.vulnerabilities +
      " vulnerabilities detected. Check the [SonarCloud report](" +
      inputs.sonar_url +
      ") for details.\n";
  }

  // Format code smells
  if (
    code_smells &&
    code_smells.trim() &&
    code_smells !== "Too many issues - check SonarCloud report"
  ) {
    const smellsArray = code_smells.split("---").filter((s) => s.trim());
    const limitedSmells = smellsArray.slice(0, 5).join("---");
    formattedIssues +=
      "\n**👃 Code Smells (showing first 5):**\n" + limitedSmells;
    if (smellsArray.length > 5) {
      formattedIssues += `\n\n*... and ${
        smellsArray.length - 5
      } more code smells. Check the [SonarCloud report](${
        inputs.sonar_url
      }) for complete details.*\n`;
    }
  } else if (
    sonarResults.summary &&
    parseInt(sonarResults.summary.code_smells) > 0
  ) {
    formattedIssues +=
      "\n**👃 Code Smells:** " +
      sonarResults.summary.code_smells +
      " code smells detected. Check the [SonarCloud report](" +
      inputs.sonar_url +
      ") for details.\n";
  }

  return formattedIssues;
}

// Helper function to create progress bar
function createProgressBar(score) {
  const filledBlocks = Math.floor(score / 10);
  const emptyBlocks = 10 - filledBlocks;
  return "█".repeat(filledBlocks) + "░".repeat(emptyBlocks);
}

// Helper function to get grade emoji
function getGradeEmoji(score) {
  if (score >= 90) return "🏆";
  if (score >= 80) return "🥇";
  if (score >= 70) return "🥈";
  if (score >= 60) return "🥉";
  return "🔧";
}

// Helper function to get status emoji
function getStatusEmoji(score) {
  if (score >= 80) return "✅";
  if (score >= 60) return "⚠️";
  return "❌";
}

async function postComment() {
  try {
    console.log("Parsing detailed SonarCloud analysis results...");

    // Parse detailed SonarCloud analysis results
    let detailedSonarResults = {};
    try {
      if (
        inputs.sonar_analysis_results &&
        inputs.sonar_analysis_results !== "{}" &&
        inputs.sonar_analysis_results.length > 2
      ) {
        // Check if JSON appears to be truncated
        if (
          !inputs.sonar_analysis_results.trim().endsWith("}") &&
          !inputs.sonar_analysis_results.trim().endsWith("]")
        ) {
          console.log("Warning: SonarCloud results appear to be truncated");
          // Try to parse partial JSON by adding closing braces
          const truncatedInput = inputs.sonar_analysis_results.trim() + "}}}}";
          try {
            detailedSonarResults = JSON.parse(truncatedInput);
            console.log("Successfully parsed truncated JSON");
          } catch (truncatedError) {
            console.log(
              "Could not parse even with added closing braces:",
              truncatedError.message
            );
          }
        } else {
          detailedSonarResults = JSON.parse(inputs.sonar_analysis_results);
          console.log("Successfully parsed complete JSON");
        }
      }
    } catch (error) {
      console.log(
        "Could not parse detailed SonarCloud results:",
        error.message
      );
      console.log(
        "Input that caused error:",
        inputs.sonar_analysis_results.substring(0, 200)
      );
    }

    const total_vulnerabilities =
      inputs.high_severity + inputs.medium_severity + inputs.low_severity;

    const comment = [
      "## 🏆 Hackathon Analysis Results",
      "",
      "**Team:** " + inputs.team_name,
      "**Technology Stack:** " + inputs.detected_stack,
      "**Overall Score:** " +
        getGradeEmoji(inputs.overall_score) +
        " **" +
        inputs.overall_score +
        "/100**",
      "",
      "### 📊 Detailed Breakdown",
      "",
      "| Category | Score | Progress | Weight |",
      "|----------|-------|----------|---------|",
      "| " +
        getStatusEmoji(inputs.test_score) +
        " **Tests & Coverage** | " +
        inputs.test_score +
        "/100 | `" +
        createProgressBar(inputs.test_score) +
        "` | 25% |",
      "| " +
        getStatusEmoji(inputs.sonar_score) +
        " **Code Quality** | " +
        inputs.sonar_score +
        "/100 | `" +
        createProgressBar(inputs.sonar_score) +
        "` | 30% |",
      "| " +
        getStatusEmoji(inputs.security_score) +
        " **Security** | " +
        inputs.security_score +
        "/100 | `" +
        createProgressBar(inputs.security_score) +
        "` | 20% |",
      "| " +
        getStatusEmoji(inputs.frontend_score) +
        " **Frontend UX** | " +
        inputs.frontend_score +
        "/100 | `" +
        createProgressBar(inputs.frontend_score) +
        "` | 10% |",
      "| " +
        getStatusEmoji(inputs.team_score) +
        " **Team Collaboration** | " +
        inputs.team_score +
        "/100 | `" +
        createProgressBar(inputs.team_score) +
        "` | 10% |",
      "| " +
        getStatusEmoji(inputs.ai_score) +
        " **AI Attribution** | " +
        inputs.ai_score +
        "/100 | `" +
        createProgressBar(inputs.ai_score) +
        "` | 5% |",
      "",
      "### 🔍 Analysis Links",
      "- 🔗 **[SonarCloud Report](" +
        inputs.sonar_url +
        ")** - Detailed code quality analysis",
      "- 📊 **[Full Analysis Logs](https://github.com/" +
        owner +
        "/" +
        repo +
        "/actions/runs/" +
        run_id +
        ")** - Complete CI results",
      "",
      "### 🔧 Code Quality Analysis",
    ];

    // Show detailed SonarCloud issues if available
    const detailedIssuesText = formatDetailedSonarIssues(detailedSonarResults);
    if (detailedIssuesText) {
      comment.push(detailedIssuesText);
    } else {
      // Fallback to basic summary
      if (inputs.sonar_status !== "UNKNOWN") {
        const gateStatus =
          inputs.sonar_status === "FAILED" ? "❌ FAILED" : "✅ PASSED";
        comment.push("**Quality Gate:** " + gateStatus);
        comment.push(
          "**Issues Found:** " +
            inputs.bugs +
            " Bugs | " +
            inputs.code_smells +
            " Code Smells | " +
            inputs.vulnerabilities +
            " Vulnerabilities"
        );
      } else {
        comment.push("⏳ **SonarCloud analysis pending or unavailable.**");
      }
      comment.push(
        "*📝 Detailed SonarCloud analysis results were not available.*"
      );
      comment.push("");
    }

    comment.push("### 🎯 Priority Action Items");
    comment.push("");

    // Generate action items based on findings
    if (total_vulnerabilities > 0) {
      comment.push(
        "**🔒 Security:** Fix " +
          total_vulnerabilities +
          " vulnerabilities (" +
          inputs.high_severity +
          " high, " +
          inputs.medium_severity +
          " medium, " +
          inputs.low_severity +
          " low)"
      );
    }

    if (inputs.test_files === 0) {
      comment.push(
        "**🧪 Testing:** Create test files and achieve basic test coverage"
      );
    } else if (inputs.coverage_percentage < 80) {
      comment.push(
        "**🧪 Testing:** Increase coverage from " +
          inputs.coverage_percentage.toFixed(1) +
          "% to 80%+"
      );
    }

    if (
      inputs.bugs > 0 ||
      inputs.code_smells > 5 ||
      inputs.sonar_status === "FAILED"
    ) {
      comment.push(
        "**🔧 Code Quality:** Address " +
          inputs.bugs +
          " bugs and " +
          inputs.code_smells +
          " code smells"
      );
    }

    if (inputs.overall_score >= 85) {
      comment.push("🏆 **Excellent work!** Your code meets high standards.");
    }

    comment.push("");
    comment.push("---");
    comment.push("");
    comment.push(
      "*🤖 Analysis completed on " +
        new Date().toISOString().split("T")[0] +
        " | PR #" +
        inputs.pr_number +
        " | Powered by GitHub Actions*"
    );

    const finalComment = comment.join("\n");

    // Post the comment
    await octokit.rest.issues.createComment({
      issue_number: inputs.pr_number,
      owner: owner,
      repo: repo,
      body: finalComment,
    });

    console.log(
      "✅ Successfully posted analysis comment to PR #" + inputs.pr_number
    );
  } catch (error) {
    console.error("❌ Error posting comment:", error.message);
    process.exit(1);
  }
}

// Run the script
postComment();
