require('dotenv').config();

const {
    getProjectsWithIssues,
    parsePivotalTasks,
    getPivotalTasksForJiraProject,
    writePivotalProjectToDisk,
    writeAllPivotalProjectsToDisk,
    logger
} = require('./lib');

(async () => {
    logger.info('Fetch all projects with issues from Jira');
    const jiraProjects = await getProjectsWithIssues(process.env.JIRA_PROJECTS.split(','));

    logger.info('Map Jira projects with issues to Pivotal projects with tasks');
    const pivotalProjects = jiraProjects.map(project => ({
        name: project.title,
        csv: parsePivotalTasks(getPivotalTasksForJiraProject(project))
    }));

    logger.info(`Write Pivotal projects to csv files`);
    pivotalProjects.forEach(writePivotalProjectToDisk);

    logger.info('Write all Pivotal projects to single CSV');
    writeAllPivotalProjectsToDisk(pivotalProjects);

    console.log('\nAll done! 👍  Go import those tasks! https://bit.ly/2BbJ1GN');
})();
