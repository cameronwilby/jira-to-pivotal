const { createLogger, format, transports } = require('winston');
const { Parser } = require('json2csv');
const JiraApi = require('jira-client');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');
const pivotalFields = require('./data/pivotalFields.json');

const pageSize = process.env.PAGE_SIZE;

const jira = new JiraApi({
    protocol: 'https',
    host: process.env.JIRA_HOST,
    username: process.env.JIRA_USERNAME,
    password: process.env.JIRA_PASSWORD,
    apiVersion: '2',
    strictSSL: true
});

const logger = createLogger({
    format: format.combine(
        format.splat(),
        format.simple()
    ),
    transports: [new transports.Console()]
});

async function getProjectsWithIssues(projectTitles) {
    const responsesGroupedByProject = await Promise.all(
        projectTitles.map(title => Promise.all([0, 1, 2, 3, 4, 5].map(page =>
            jira.searchJira(`PROJECT="${title}" ORDER BY key ASC`, {
                startAt: page * pageSize,
                maxResults: pageSize
            })
        )))
    );
    const issuesGroupedByProject = responsesGroupedByProject.map((response, i) => ({
        title: projectTitles[i],
        issues: _.flatten(_.flatten(response).map(r => r.issues))
    }));
    return issuesGroupedByProject;
}


function getPivotalTasksForJiraProject(project) {
    return project.issues
        .filter(issue => !['Sub-task', 'Pair Sub-task'].includes(issue.fields.issuetype.name))
        .map(issue => {
            const subtasks = project.issues
                .filter(i => ['Sub-task', 'Pair Sub-task'].includes(i.fields.issuetype.name) && i.fields.parent.key === issue.key)
                .slice(0, 10);

            const epic = project.issues.find(i => i.fields.issuetype.name === 'Epic' && i.key === issue.fields.customfield_10013);

            return {
                Title: issue.fields.summary,
                Labels: `${(epic ? [epic.fields.summary.toLowerCase()] : []).concat(issue.fields.labels).join(',')}`,
                Type: normalizeIssueType(issue.fields.issuetype.name),
                Estimate: Math.min(issue.fields.customfield_10020 || 0, 8) || 0,
                'Current State': normalizeCurrentState(issue),
                'Created at': moment(new Date(issue.fields.created)).tz('America/Los_Angeles').format(),
                'Accepted at': issue.fields.resolutiondate ? moment(new Date(issue.fields.resolutiondate)).tz('America/Los_Angeles').format() : null,
                'Requested by': issue.fields.reporter.displayName,
                'Description': JSON.stringify(issue.fields.description + '\\n\\nOriginal Jira Ticket: https://sendlane.atlassian.net/browse/' + issue.key),
                'Owned By': issue.fields.assignee && issue.fields.assignee.name,
                subtasks
            };
        });
}

function parsePivotalTasks(pivotalTasks) {
    const parser = new Parser({ fields: pivotalFields });

    let lines = parser.parse(pivotalTasks).split('\n');

    lines = [
        lines[0] + new Array(10).fill(',Task,Task Status').join(''),
        ...pivotalTasks.map((task, i) => {
            let line = lines[i + 1];

            task.subtasks.forEach(subtask => {
                line += `,${subtask.fields.summary},${subtask.fields.resolution && subtask.fields.resolution.name === 'Done' ? 'Completed' : 'Not Completed'}`
            });

            for (let j = 0; j < (10 - task.subtasks.length); j++) {
                line += ',,';
            }

            return line;
        })
    ];

    return lines.join('\n');
}

function normalizeIssueType(name) {
    switch (name.toLowerCase()) {
        case 'story':
        case 'pair story':
            return 'Feature';
        case 'bug':
        case 'pair bug':
            return 'Bug'
        case 'epic':
            return 'Epic';
        case 'discussion':
        case 'task':
        case 'pair task':
        case 'sub-task':
        case 'pair sub-task':
            return 'Chore';
        default:
            return '💩';
    }
}

function normalizeCurrentState(issue) {
    switch (issue.fields.status.name) {
        case 'In Progress':
            return 'Started';
        case 'Closed':
        case 'Done':
        case 'Ready to Review':
        case 'Ready to Deploy':
            return 'Accepted';
        default:
            return 'Unstarted';
    }
}

function writePivotalProjectToDisk(pivotalProject) {
    const filename = path.join(__dirname, 'projects', `${pivotalProject.name}.csv`);

    logger.info(`\t Write ${filename} to disk`);

    const onSuccess = (err) => err ? logger.error(err) : null;

    fs.writeFile(filename, pivotalProject.csv, onSuccess);
}

function writeAllPivotalProjectsToDisk(pivotalProjects) {
    const allFileName = path.join(__dirname, 'projects', 'All Projects.csv');
    const allPivotalTitles = `${pivotalFields.join(',')},${new Array(process.env.SUBTASKS).fill('Task,Task Status').join(',')}`;
    const allPivotalTasks = _.flatten(pivotalProjects.map(file => file.csv.split('\n').slice(1)));
    const csv = [allPivotalTitles, ...allPivotalTasks].join('\n');
    fs.writeFile(allFileName, csv, (err) => {
        if (err) return logger.error(err);
    });
}

module.exports = {
    getProjectsWithIssues,
    parsePivotalTasks,
    getPivotalTasksForJiraProject,
    writePivotalProjectToDisk,
    writeAllPivotalProjectsToDisk,
    logger
};
