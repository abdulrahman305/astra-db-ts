#!/bin/sh
# -*- mode: Python -*-
# Copyright DataStax, Inc.
#
# Please see the included license file for details.
#
# Original code from cqlsh.py is
#
# Licensed to the Apache Software Foundation (ASF) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The ASF licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

""":"
# bash code here; finds a suitable python interpreter and execs this file.
# prefer unqualified "python" if suitable:
python -c 'import sys; sys.exit(not (0x020700b0 < sys.hexversion))' 2>/dev/null \
    && exec python "$0" "$@"
for pyver in 3 2.7; do
    which python$pyver > /dev/null 2>&1 && exec python$pyver "$0" "$@"
done
echo "No appropriate python interpreter found." >&2
exit 1
":"""

from __future__ import with_statement, unicode_literals

import os, stat
import getpass
import platform
import sys
from glob import glob

CQL_LIB_PREFIX = 'cassandra-driver-internal-only-'
CASSANDRA_PATH = os.path.join(os.path.dirname(os.path.realpath(__file__)), '..')
ZIPLIB_DIRS = [os.path.join(CASSANDRA_PATH, 'lib')]
myplatform = platform.system()

# DSE: Also looking in DSE_ENV and /usr/share/dse location. The latter
# is there because I have seen systems where DSE_HOME is just /usr...
# I am fixing that in cassandra.in.sh, but there may be old stuff floating
# around, so better safe than sorry.
if myplatform in ('Linux', 'Darwin'):
    ZIPLIB_DIRS.append('/usr/share/cassandra/lib')
    ZIPLIB_DIRS.append(os.getenv('DSE_HOME', '/usr/share/dse') + '/lib')
    ZIPLIB_DIRS.append(os.getenv('DSE_HOME', '/usr/share/dse') + '/cassandra/lib')
    ZIPLIB_DIRS.append('/usr/share/dse/lib')
    ZIPLIB_DIRS.append('/usr/share/dse/cassandra/lib')
    ZIPLIB_DIRS.append(CASSANDRA_PATH + '/zipfiles')

if os.environ.get('CQLSH_NO_BUNDLED', ''):
    ZIPLIB_DIRS = ()


def find_zip(libprefix):
    for ziplibdir in ZIPLIB_DIRS:
        zips = glob(os.path.join(ziplibdir, libprefix + '*.zip'))
        if zips:
            return max(zips)  # probably the highest version, if multiple

cql_zip = find_zip(CQL_LIB_PREFIX)
if cql_zip:
    ver = os.path.splitext(os.path.basename(cql_zip))[0][len(CQL_LIB_PREFIX):]
    sys.path.insert(0, os.path.join(cql_zip, 'cassandra-driver-' + ver))

GEOMET_PREFIX = "geomet-"
geomet_zip = find_zip(GEOMET_PREFIX)
if geomet_zip:
    ver = os.path.splitext(os.path.basename(geomet_zip))[0][len(GEOMET_PREFIX):]
    sys.path.insert(0, os.path.join(geomet_zip, GEOMET_PREFIX + ver))

third_parties = ('futures-', 'six-')

for lib in third_parties:
    lib_zip = find_zip(lib)
    if lib_zip:
        sys.path.insert(0, lib_zip)

os.environ['CQLSH_NO_BUNDLED'] = 'true'

# Get the search core management timeout if it's been set
core_management_timeout = int(os.environ.get('CQLSH_SEARCH_MANAGEMENT_TIMEOUT_SECONDS', '600'))

import cqlsh  # nopep8
from cqlshlib import cqlshhandling  # nopep8
from cassandra.metadata import maybe_escape_name  # nopep8
from cassandra.policies import WhiteListRoundRobinPolicy
from cassandra.cluster import ExecutionProfile, EXEC_PROFILE_DEFAULT, _NOT_SET
from cassandra.connection import UnixSocketEndPoint
from cassandra.query import ordered_dict_factory
# This unused import causes type registration, do not remove
import cassandra.cqltypes
from dselib.geotypes import patch_import_conversion  # nopep8
from dselib.daterangetype import patch_daterange_import_conversion  # nopep8
from cqlshlib.driver import cluster_factory, is_unix_socket
from cqlshlib.copyutil import ImportConversion  # nopep8
from dselib.searchhandling import search_syntax_rules  # nopep8
from cqlshlib import sslhandling  # nopep8
from cqlshlib.cql3handling import CqlRuleSet
from cqlshlib.cqlhandling import Hint
from cqlhelp.terminalhelp import get_terminal_help_topics, print_terminal_help_topic

completer_for = CqlRuleSet.completer_for

patch_import_conversion(ImportConversion)
patch_daterange_import_conversion(ImportConversion)

DSE_CQL_HTML_FALLBACK = 'https://docs.datastax.com/en/dse/6.8/cql/index.html'
DSE_CQL_HTML_PATHS = glob('/usr/share/doc/dse-libcassandra*/CQL.html')
if DSE_CQL_HTML_PATHS:
    cqlsh.CASSANDRA_CQL_HTML = sorted(DSE_CQL_HTML_PATHS)[-1]

if cqlsh.CASSANDRA_CQL_HTML == cqlsh.CASSANDRA_CQL_HTML_FALLBACK:
    cqlsh.CASSANDRA_CQL_HTML = DSE_CQL_HTML_FALLBACK


def _append_rule_to_syntax_at_pos(existing_syntax_rules, rule, position):
    """
    The existing syntax rules will be split by '\n' and then the new rule will
    be added at the given position. The new rules will also be parsed for correctness.
    If any error happens, the existing syntax rules will be returned.

    :param existing_syntax_rules: The existing syntax rules where the new rule should be added to
    :param rule: The syntax rule to add
    :param position: The position in the existing syntax rule where this should be added
    :return:
    """
    try:
        new_syntax_rules = existing_syntax_rules.splitlines()
        new_syntax_rules.insert(position, rule)
        new_syntax_rules = '\n'.join(new_syntax_rules)
        from cqlshlib import cql3handling
        cql3handling.CqlRuleSet.parse_rules(new_syntax_rules)
        return new_syntax_rules
    except Exception as ex:
        sys.stderr.write('Could not append DSE-specific syntax rules: {msg}\n'.format(msg=ex.message))
        return existing_syntax_rules

from cqlshlib.cql3handling import CqlRuleSet, working_on_keyspace, ks_prop_val_mapkey_completer, \
    ks_prop_val_mapval_completer, get_table_meta  # nopep8
from dselib.dsehandling import dse_cf_prop_val_mapkey_completer, dse_cf_prop_val_mapval_completer  # nopep8


# DSE-specific DESCRIBE rules for SEARCH
dse_describe_rule = r'| ("ACTIVE" | "PENDING") "SEARCH" "INDEX" ("SCHEMA" | "CONFIG") "ON" cf=<columnFamilyName>'

cqlsh_dse_describe_cmd_syntax_rules = _append_rule_to_syntax_at_pos(cqlshhandling.cqlsh_describe_cmd_syntax_rules,
                                                                    dse_describe_rule, -3)


cqlsh_dse_execute_cmd_syntax_rules = r'''
<executeCommand> ::= "EXECUTE" "AS" ( user=<username> )?
                     ;
'''

cqlsh_dse_statements = r'''
<thirdPartyStatement> ::= <searchStatement>
                        | <restrictRowsStatement>
                        | <unrestrictRowsStatement>
                        ;

<restrictRowsStatement> ::= "RESTRICT" "ROWS" "ON" cf=<columnFamilyName> "USING" colname=<cident>
                          ;

<unrestrictRowsStatement> ::= "UNRESTRICT" "ROWS" "ON" cf=<columnFamilyName>
                            ;
'''

cqlsh_dse_permissions = r'''
<thirdPartyPermission> ::= <searchDomain> "." <searchPermission>
                         ;

<searchDomain> ::= searchDomain=("SEARCH")
                 ;

<searchPermission> ::= "CREATE"
                     | "ALTER"
                     | "DROP"
                     | "RELOAD"
                     | "REBUILD"
                     | "COMMIT"
                     ;

'''

@CqlRuleSet.completer_for('searchDomain', 'searchDomain')
def search_domain_completer(ctxt, cass):
    return ['SEARCH.CREATE', 'SEARCH.ALTER', 'SEARCH.DROP', 'SEARCH.RELOAD', 'SEARCH.REBUILD', 'SEARCH.COMMIT']

cqlsh_dse_resources = r'''
<thirdPartyResource> ::= <searchIndexResource>
                       | <authenticationSchemeResource>
                       | <rpcCallResource>
                       | <dseRowResource>
                       ;

<searchIndexResource> ::= ( "ALL" "SEARCH" "INDICES" )
                        | ( "SEARCH" "INDEX" cf=<columnFamilyName> )
                        | ( "SEARCH" "KEYSPACE" ksname=<keyspaceName> )
                        ;

<authenticationSchemeResource> ::= ( "ALL" "AUTHENTICATION" "SCHEMES" )
                                 | ( ( "INTERNAL" | "LDAP" | "KERBEROS" ) "SCHEME" )
                                 ;

<rpcCallResource> ::= ( "ALL" "REMOTE" "CALLS" )
                    | ( "REMOTE" "OBJECT" <remoteObjectName> )
                    | ( "REMOTE" "METHOD" <remoteObjectName> "." <remoteObjectMethodName> )
                    ;

<remoteObjectName> ::= remoteObjectName=(<identifier>)
                     ;

<remoteObjectMethodName> ::= remoteObjectMethodName=(<identifier>)
                           ;

<dseRowResource> ::= value=<stringLiteral> "ROWS" "IN" ( "TABLE" )? cf=<columnFamilyName>
                   ;

'''


@CqlRuleSet.completer_for('remoteObjectName', 'remoteObjectName')
def remote_object_completer(ctxt, cass):
    return [Hint('<remoteObjectName>')]

@CqlRuleSet.completer_for('remoteObjectMethodName', 'remoteObjectMethodName')
def remote_object_completer(ctxt, cass):
    return [Hint('<remoteObjectMethodName>')]

@CqlRuleSet.completer_for('restrictRowsStatement', 'colname')
def restrict_rows_colname_completer(ctxt, cass):
    table_meta = get_table_meta(ctxt, cass)
    if not table_meta or not table_meta.columns:
        return []
    return map(maybe_escape_name, table_meta.columns.keys())

@CqlRuleSet.completer_for('dseRowResource', 'value')
def row_level_restriction_completer(ctxt, cass):
    return ['<rowLevelRestrictionValue>']

cqlsh_dse_special_cmd_command_syntax_rules = _append_rule_to_syntax_at_pos(
    cqlshhandling.cqlsh_special_cmd_command_syntax_rules, r'| <executeCommand>', -5)


cqlshhandling.cqlsh_extra_syntax_rules = cqlshhandling.cqlsh_cmd_syntax_rules + \
    cqlsh_dse_special_cmd_command_syntax_rules + \
    cqlsh_dse_describe_cmd_syntax_rules + \
    cqlshhandling.cqlsh_consistency_cmd_syntax_rules + \
    cqlshhandling.cqlsh_consistency_level_syntax_rules + \
    cqlshhandling.cqlsh_serial_consistency_cmd_syntax_rules + \
    cqlshhandling.cqlsh_serial_consistency_level_syntax_rules + \
    cqlshhandling.cqlsh_show_cmd_syntax_rules + \
    cqlshhandling.cqlsh_source_cmd_syntax_rules + \
    cqlshhandling.cqlsh_capture_cmd_syntax_rules + \
    cqlshhandling.cqlsh_copy_cmd_syntax_rules + \
    cqlsh_dse_execute_cmd_syntax_rules + \
    cqlshhandling.cqlsh_timing_cmd_syntax_rules + \
    cqlshhandling.cqlsh_copy_option_syntax_rules + \
    cqlshhandling.cqlsh_copy_option_val_syntax_rules + \
    cqlshhandling.cqlsh_debug_cmd_syntax_rules + \
    cqlshhandling.cqlsh_help_cmd_syntax_rules + \
    cqlshhandling.cqlsh_tracing_cmd_syntax_rules + \
    cqlshhandling.cqlsh_expand_cmd_syntax_rules + \
    cqlshhandling.cqlsh_paging_cmd_syntax_rules + \
    cqlshhandling.cqlsh_login_cmd_syntax_rules + \
    cqlshhandling.cqlsh_exit_cmd_syntax_rules + \
    cqlshhandling.cqlsh_clear_cmd_syntax_rules + \
    cqlshhandling.cqlsh_question_mark + \
    cqlsh_dse_statements + \
    cqlsh_dse_permissions + \
    cqlsh_dse_resources + \
    search_syntax_rules

cqlshhandling.my_commands_ending_with_newline = tuple(set(cqlshhandling.my_commands_ending_with_newline).union({'execute'}))


class SearchResourceNotFound(Exception):
    pass

# use DSE-specific completer for compaction strategies
@CqlRuleSet.completer_for('propertyValue', 'propmapkey')
def prop_val_mapkey_completer(ctxt, cass):
    if working_on_keyspace(ctxt):
        return ks_prop_val_mapkey_completer(ctxt, cass)
    else:
        return dse_cf_prop_val_mapkey_completer(ctxt, cass)


# use DSE-specific completer for available tiering strategies when TieredCompactionStrategy was selected
@CqlRuleSet.completer_for('propertyValue', 'propmapval')
def prop_val_mapval_completer(ctxt, cass):
    if working_on_keyspace(ctxt):
        return ks_prop_val_mapval_completer(ctxt, cass)
    else:
        return dse_cf_prop_val_mapval_completer(ctxt, cass)

@cqlshhandling.cqlsh_syntax_completer('helpCommand', 'topic')
def complete_help(ctxt, cqlsh):
    return sorted([t.upper() for t in get_terminal_help_topics() + cqlsh.get_help_topics()])

from cqlsh import Shell as OriginalShell  # nopep8


class DSEShell(OriginalShell):
    def __init__(self, hostname, port, color=False,
                 username=None, password=None, encoding=None, stdin=None, tty=True,
                 completekey=cqlsh.DEFAULT_COMPLETEKEY, browser=None, use_conn=None,
                 cqlver=None, keyspace=None, secure_connect_bundle=None,
                 consistency_level=None, serial_consistency_level=None,
                 tracing_enabled=False,
                 timing_enabled=False,
                 expand_enabled=False,
                 display_nanotime_format=cqlsh.DEFAULT_NANOTIME_FORMAT,
                 display_timestamp_format=cqlsh.DEFAULT_TIMESTAMP_FORMAT,
                 display_date_format=cqlsh.DEFAULT_DATE_FORMAT,
                 display_float_precision=cqlsh.DEFAULT_FLOAT_PRECISION,
                 display_double_precision=cqlsh.DEFAULT_DOUBLE_PRECISION,
                 display_timezone=None,
                 max_trace_wait=cqlsh.DEFAULT_MAX_TRACE_WAIT,
                 ssl=False,
                 single_statement=None,
                 request_timeout=cqlsh.DEFAULT_REQUEST_TIMEOUT_SECONDS,
                 protocol_version=None,
                 connect_timeout=cqlsh.DEFAULT_CONNECT_TIMEOUT_SECONDS,
                 no_file_io=cqlsh.DEFAULT_NO_FILE_IO,
                 is_subshell=False,
                 debug=False):
        from dselib.authfactory import get_auth_provider
        if username:
            if not password:
                password = getpass.getpass()

        auth_provider = get_auth_provider(cqlsh.CONFIG_FILE, os.environ, username, password, cqlsh.options) \
            if not is_unix_socket(hostname) else None

        self.execute_as = None

        if not consistency_level:
            raise Exception('Argument consistency_level must not be None')
        if not serial_consistency_level:
            raise Exception('Argument serial_consistency_level must not be None')
        self.consistency_level = consistency_level
        self.serial_consistency_level = serial_consistency_level

        execution_profile = ExecutionProfile(row_factory=ordered_dict_factory,
                                             request_timeout=request_timeout,
                                             consistency_level=self.consistency_level,
                                             serial_consistency_level=self.serial_consistency_level)

        self.execution_profiles = {EXEC_PROFILE_DEFAULT: execution_profile}

        if use_conn:
            conn = use_conn
        else:
            conn = cluster_factory(
                hostname,
                port=port,
                protocol_version=protocol_version if protocol_version is not None else _NOT_SET,
                cql_version=cqlver,
                auth_provider=auth_provider,
                ssl_options=sslhandling.ssl_settings(hostname, cqlsh.CONFIG_FILE) if ssl else None,
                control_connection_timeout=connect_timeout,
                connect_timeout=connect_timeout,
                execution_profiles=self.execution_profiles,
                secure_connect_bundle=secure_connect_bundle)

            if debug and ssl:
                sys.stderr.write("Using SSL options: %s\n" % (sslhandling.human_readable_ssl_options(conn.ssl_options),))

        OriginalShell.__init__(self, hostname, port, color=color, auth_provider=auth_provider,
                               username=username, password=password, encoding=encoding, stdin=stdin,
                               tty=tty,
                               completekey=completekey, browser=browser, use_conn=conn,
                               cqlver=cqlver, keyspace=keyspace,
                               secure_connect_bundle=secure_connect_bundle,
                               consistency_level=consistency_level,
                               serial_consistency_level=serial_consistency_level,
                               tracing_enabled=tracing_enabled,
                               timing_enabled=timing_enabled,
                               expand_enabled=expand_enabled,
                               display_nanotime_format=display_nanotime_format,
                               display_timestamp_format=display_timestamp_format,
                               display_date_format=display_date_format,
                               display_float_precision=display_float_precision,
                               display_double_precision=display_double_precision,
                               display_timezone=display_timezone,
                               max_trace_wait=max_trace_wait,
                               ssl=ssl,
                               single_statement=single_statement,
                               request_timeout=request_timeout,
                               protocol_version=protocol_version,
                               connect_timeout=connect_timeout,
                               no_file_io=no_file_io,
                               is_subshell=is_subshell,
                               debug=debug)

        self.owns_connection = not use_conn
        self.execution_profile = self.session.get_execution_profile(EXEC_PROFILE_DEFAULT)

    def do_execute(self, parsed):
        """
        EXECUTE AS [cqlsh only]

          Execute your queries as another user.

        EXECUTE AS <username>

          Executes future requests as that user.

        EXECUTE AS

          Executes future requests as yourself.
        """
        username = parsed.get_binding('user')
        if username is None:
            self.execute_as = None
            print('Disabling proxy execution')
        else:
            self.execute_as = {'ProxyExecute': username.encode()}
            print('Executing queries as %s.' % username)

    def describe_search_resource(self, ksname, cfname, resource_type, resource):
        if ksname is None:
            ksname = self.current_keyspace
        if ksname is None:
            raise cqlsh.NoKeyspaceError("No keyspace specified and no current keyspace")
        print
        if resource == 'schema':
            resource_name = 'schema.xml'
        else:
            resource_name = 'solrconfig.xml'
        if resource_type == 'active':
            resource_name += '.bak'
        try:
            result, = self.session.execute("select blobAsText(resource_value) as resource" +
                                           " from solr_admin.solr_resources where core_name " +
                                           "= '%s.%s' and resource_name = '%s'" % (ksname, cfname, resource_name))
            print(result['resource'])
        except:
            raise SearchResourceNotFound("Search resource not found for index %s.%s" % (ksname, cfname))
        print

    def execute_simple_statement(self, statement):
        return self.session.execute_async(statement, trace=self.tracing_enabled, custom_payload = self.execute_as)

    def do_describe(self, parsed):
        what = parsed.matched[1][1].lower()

        if (what == 'active' or what == 'pending') and parsed.matched[2][1].lower() == 'search' and parsed.matched[3][1].lower() == 'index':
            resource = parsed.matched[4][1].lower()
            ks = self.cql_unprotect_name(parsed.get_binding('ksname', None))
            cf = self.cql_unprotect_name(parsed.get_binding('cfname'))
            self.describe_search_resource(ks, cf, what, resource)
        else:
            OriginalShell.do_describe(self, parsed)

    do_desc = do_describe

    def perform_simple_statement(self, statement):
        if not statement:
            return False, None

        default_timeout = self.execution_profile.request_timeout

        # Boost the session timeout for any search core management statements
        statement_prefix = " ".join(statement.query_string.lower().split())
        if (default_timeout is not None and default_timeout == cqlsh.DEFAULT_REQUEST_TIMEOUT_SECONDS and
            (statement_prefix.startswith("create search index") or
             statement_prefix.startswith("alter search index") or
             statement_prefix.startswith("reload search index") or
             statement_prefix.startswith("rebuild search index") or
             statement_prefix.startswith("commit search index") or
             statement_prefix.startswith("drop search index"))):
            self.execution_profile.request_timeout = core_management_timeout

        success, future = OriginalShell.perform_simple_statement(self, statement)

        # reset timeout to its original value
        self.execution_profile.request_timeout = default_timeout

        return success, future

    def do_help(self, parsed):
        """
        HELP [cqlsh only]

        Gives information about cqlsh commands. To see available topics,
        enter 'HELP' without any arguments.

        To see help on a topic type 'HELP <topic>'.
        For example 'HELP CAPTURE' or 'HELP ALTER_KEYSPACE'.

        Full documentation available at:
          https://docs.datastax.com/en/dse/6.8/cql/index.html
        """
        topics = parsed.get_binding('topic', ())
        if not topics:
            shell_topics = [t.upper() for t in self.get_help_topics()]
            print('')
            self.print_topics("Shell command help topics:", shell_topics, 15, 80)
            print("Full documentation for shell commands:")
            print("  https://docs.datastax.com/en/dse/6.8/cql/cql/cql_reference/cqlsh_commands/cqlshCommandsTOC.html")
            print('')
            cql_topics = get_terminal_help_topics()
            self.print_topics("CQL command help topics:", cql_topics, 15, 80)
            print("Full documentation for CQL commands:")
            print("  https://docs.datastax.com/en/dse/6.8/cql/cql/cql_reference/cql_commands/cqlCommandsTOC.html")
            print('')
            return
        for t in topics:
            if t.lower() in self.get_help_topics():
                doc = getattr(self, 'do_' + t.lower()).__doc__
                self.stdout.write(doc + "\n")
            elif t.lower() in get_terminal_help_topics():
                print_terminal_help_topic(t)
            else:
                self.printerr("*** No help on %s" % (t,))

cqlsh.Shell = DSEShell

if __name__ == '__main__':
    cqlsh.main(*cqlsh.read_options(sys.argv[1:], os.environ))

# vim: set ft=python et ts=4 sw=4 :
